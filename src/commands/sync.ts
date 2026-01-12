import { exec, execRaw, getRepoRoot, loadConfig, getCurrentBranch, getDataDir, getRepoIdentifier } from "../git"
import { readFile, writeFile, rm, mkdtemp, cp, mkdir } from "fs/promises"
import { join } from "path"
import { tmpdir } from "os"
import { existsSync } from "fs"
import {
  buildDependencyGraph,
  topologicalSort,
  CyclicDependencyError,
  MissingDependencyError,
} from "../utils/graph"
import { listPatchRefs, readPatchRef } from "../utils/patch-refs"
import {
  saveUserRerereCache,
  restoreUserRerereCache,
  clearRerereCache,
  enableRerere,
  listLocalRerereEntries,
  restoreRerereFromRefs,
  captureNewRerereEntries,
  storeRerereRef,
  fetchRerereRefs,
} from "../utils/rerere-cache"

/**
 * Check if all conflicts have been auto-resolved by rerere.
 * Returns true if there are unmerged files but none have conflict markers.
 */
async function tryRerereAutoResolve(): Promise<boolean> {
  // Run git rerere to apply any stored resolutions
  await execRaw("git rerere")

  // Get list of unmerged files
  const statusResult = await execRaw("git status --porcelain")
  const unmergedFiles = statusResult.stdout
    .split("\n")
    .filter((line) => line.startsWith("UU "))
    .map((line) => line.slice(3))

  if (unmergedFiles.length === 0) {
    return false // No conflicts to resolve
  }

  // Check if any unmerged file still has conflict markers
  for (const file of unmergedFiles) {
    const content = await readFile(file, "utf-8").catch(() => "")
    if (content.includes("<<<<<<<") || content.includes(">>>>>>>")) {
      return false // Still has unresolved conflicts
    }
  }

  // All conflicts were auto-resolved by rerere
  return true
}

interface SyncState {
  currentPatch: string
  remainingPatches: string[]
  commitMessage: string
  originalBranch: string
  applied: number
  // Rerere cache state
  rerereHashesBeforeSync: string[]
  userRerereCachePath: string | null
}

async function getSyncStatePath(): Promise<string> {
  const repoRoot = await getRepoRoot()
  const repoId = await getRepoIdentifier(repoRoot)
  return join(getDataDir(), repoId, "sync-state.json")
}

async function saveSyncState(state: SyncState): Promise<void> {
  const statePath = await getSyncStatePath()
  await mkdir(join(statePath, ".."), { recursive: true })
  await writeFile(statePath, JSON.stringify(state, null, 2))
}

async function loadSyncState(): Promise<SyncState | null> {
  const statePath = await getSyncStatePath()
  if (!existsSync(statePath)) return null
  const content = await readFile(statePath, "utf-8")
  return JSON.parse(content)
}

async function clearSyncState(): Promise<void> {
  const statePath = await getSyncStatePath()
  if (existsSync(statePath)) {
    await rm(statePath)
  }
}

export async function syncContinue(): Promise<void> {
  const state = await loadSyncState()
  if (!state) {
    console.error("No sync in progress. Run 'patchwork sync' first.")
    process.exit(1)
  }

  const repoRoot = await getRepoRoot()
  const { config } = await loadConfig(repoRoot)

  // Run git rerere to record the resolution before committing
  await execRaw("git rerere")

  // Capture new rerere entries created from this resolution
  const newRerereHashes = await captureNewRerereEntries(state.rerereHashesBeforeSync)
  if (newRerereHashes.length > 0) {
    console.log(`Recording ${newRerereHashes.length} conflict resolution(s)...`)
    for (const hash of newRerereHashes) {
      await storeRerereRef(hash)
    }
  }

  // Commit the resolved conflict
  console.log(`Completing ${state.currentPatch}...`)
  await exec("git add -A")

  const messagePath = join(tmpdir(), "patchwork-continue-msg.txt")
  await writeFile(messagePath, state.commitMessage)
  await exec(`git commit -F "${messagePath}"`)
  await rm(messagePath)

  let applied = state.applied + 1

  // Continue with remaining patches
  for (const patchName of state.remainingPatches) {
    console.log(`Applying ${patchName}...`)

    const patchText = await readPatchRef(patchName)
    const { message, diff, subject } = parsePatch(patchText)
    const patchTempDir = await mkdtemp(join(tmpdir(), "patchwork-"))
    const diffPath = join(patchTempDir, "patch.diff")
    const messagePath = join(patchTempDir, "patch-message.txt")

    let applyResult: { stdout: string; stderr: string; exitCode: number } | null = null
    let patchApplied = false

    try {
      await writeFile(diffPath, `${diff}\n`)
      await writeFile(messagePath, `${message}\n`)

      applyResult = await execRaw(`git apply --3way "${diffPath}"`)

      if (applyResult.exitCode === 0) {
        await exec("git add -A")
        await exec(`git commit -F "${messagePath}"`)
        applied++
        patchApplied = true
      } else {
        // Try rerere auto-resolve
        const autoResolved = await tryRerereAutoResolve()
        if (autoResolved) {
          console.log("  (auto-resolved by rerere)")
          await exec("git add -A")
          await exec(`git commit -F "${messagePath}"`)
          applied++
          patchApplied = true
        }
      }
    } finally {
      await rm(patchTempDir, { recursive: true, force: true })
    }

    if (!patchApplied) {
      const remainingIdx = state.remainingPatches.indexOf(patchName)
      const newRemaining = state.remainingPatches.slice(remainingIdx + 1)

      // Update rerere hashes to include any new ones from previous resolutions
      const currentRerereHashes = await listLocalRerereEntries()

      await saveSyncState({
        currentPatch: patchName,
        remainingPatches: newRemaining,
        commitMessage: message,
        originalBranch: state.originalBranch,
        applied,
        rerereHashesBeforeSync: currentRerereHashes,
        userRerereCachePath: state.userRerereCachePath,
      })

      console.error("")
      console.error(`Failed to apply ${patchName}`)
      console.error("")
      console.error("Resolve conflicts, then run:")
      console.error("  patchwork sync --continue")
      console.error("")
      console.error("Or abort with:")
      console.error("  git reset --hard")
      console.error(`  git checkout ${state.originalBranch}`)
      process.exit(1)
    }
  }

  // Restore user's original rerere cache
  await restoreUserRerereCache(state.userRerereCachePath)

  await clearSyncState()
  const buildBranch = config.buildBranch
  console.log("")
  console.log(`Successfully applied ${applied} patch(es)`)
  console.log(`Build branch '${buildBranch}' is ready`)
}

export async function sync(): Promise<void> {
  const repoRoot = await getRepoRoot()
  const { config, configDir } = await loadConfig(repoRoot)
  const upstream = `${config.upstream.remote}/${config.upstream.branch}`
  const originalBranch = await getCurrentBranch()

  console.log(`Fetching ${config.upstream.remote}...`)
  await exec(`git fetch ${config.upstream.remote}`)

  // Set up rerere for conflict resolution persistence
  console.log("Setting up conflict resolution cache...")
  const userRerereCachePath = await saveUserRerereCache()
  await clearRerereCache()
  await fetchRerereRefs(config.remote)
  await restoreRerereFromRefs()
  await enableRerere()
  const rerereHashesBeforeSync = await listLocalRerereEntries()

  // Get all patches from refs
  const allPatchNames = await listPatchRefs()

  if (allPatchNames.length === 0) {
    console.log("No patches to apply.")
    return
  }

  // Filter out merged/abandoned patches
  const patchNames = allPatchNames.filter((patchName) => {
    const metadata = config.patches?.[patchName]
    const status = metadata?.status ?? "active"
    if (status === "merged") {
      console.log(`Skipping ${patchName} (merged upstream)`)
      return false
    }
    if (status === "abandoned") {
      console.log(`Skipping ${patchName} (abandoned)`)
      return false
    }
    return true
  })

  if (patchNames.length === 0) {
    console.log("No active patches to apply.")
    return
  }

  // Build dependency graph and get sorted order
  let sortedPatches: string[]
  try {
    const graph = buildDependencyGraph(patchNames, config.patches)
    sortedPatches = topologicalSort(graph)
  } catch (err) {
    if (err instanceof CyclicDependencyError) {
      console.error(`Error: ${err.message}`)
      console.error("Please resolve the cyclic dependency before syncing.")
      process.exit(1)
    }
    if (err instanceof MissingDependencyError) {
      console.error(`Error: ${err.message}`)
      console.error("Please ensure all dependencies exist or update the manifest.")
      process.exit(1)
    }
    throw err
  }

  console.log(`Found ${sortedPatches.length} patch(es) to apply`)
  if (config.patches && Object.keys(config.patches).length > 0) {
    console.log("(ordered by dependencies)")
  }
  console.log("")

  const buildBranch = config.buildBranch
  const exclude = config.exclude

  // Save excluded paths to temp before reset
  const tempDir = await mkdtemp(join(tmpdir(), "patchwork-exclude-"))
  const savedPaths: string[] = []

  for (const excludePath of exclude) {
    const fullPath = join(repoRoot, excludePath)
    if (existsSync(fullPath)) {
      const tempPath = join(tempDir, excludePath)
      await cp(fullPath, tempPath, { recursive: true })
      savedPaths.push(excludePath)
    }
  }

  if (savedPaths.length > 0) {
    console.log(`Preserving: ${savedPaths.join(", ")}`)
  }

  // Delete existing build branch if it exists
  await exec(`git branch -D ${buildBranch}`).catch(() => {})

  console.log(`Creating ${buildBranch} from ${upstream}...`)
  await exec(`git checkout -B ${buildBranch} ${upstream}`)

  // Restore excluded paths after reset
  for (const excludePath of savedPaths) {
    const tempPath = join(tempDir, excludePath)
    const fullPath = join(repoRoot, excludePath)
    await cp(tempPath, fullPath, { recursive: true })
  }

  // Clean up temp dir
  await rm(tempDir, { recursive: true, force: true })

  let applied = 0
  for (const patchName of sortedPatches) {
    console.log(`Applying ${patchName}...`)

    // Read patch from refs
    const patchText = await readPatchRef(patchName)
    const { message, diff, subject } = parsePatch(patchText)
    const patchTempDir = await mkdtemp(join(tmpdir(), "patchwork-"))
    const diffPath = join(patchTempDir, "patch.diff")
    const messagePath = join(patchTempDir, "patch-message.txt")

    let applyResult: { stdout: string; stderr: string; exitCode: number } | null = null
    let patchApplied = false

    try {
      await writeFile(diffPath, `${diff}\n`)
      await writeFile(messagePath, `${message}\n`)

      applyResult = await execRaw(`git apply --3way "${diffPath}"`)

      if (applyResult.exitCode === 0) {
        await exec("git add -A")
        await exec(`git commit -F "${messagePath}"`)
        applied++
        patchApplied = true
      } else {
        // Try rerere auto-resolve
        const autoResolved = await tryRerereAutoResolve()
        if (autoResolved) {
          console.log("  (auto-resolved by rerere)")
          await exec("git add -A")
          await exec(`git commit -F "${messagePath}"`)
          applied++
          patchApplied = true
        }
      }
    } finally {
      await rm(patchTempDir, { recursive: true, force: true })
    }

    if (!patchApplied) {
      const patchIdx = sortedPatches.indexOf(patchName)
      const remainingPatches = sortedPatches.slice(patchIdx + 1)

      // Get current rerere hashes (may have grown from previous resolutions)
      const currentRerereHashes = await listLocalRerereEntries()

      await saveSyncState({
        currentPatch: patchName,
        remainingPatches,
        commitMessage: message,
        originalBranch,
        applied,
        rerereHashesBeforeSync: currentRerereHashes,
        userRerereCachePath,
      })

      console.error("")
      console.error(`Failed to apply ${patchName}`)
      console.error("")
      console.error("Resolve conflicts, then run:")
      console.error("  patchwork sync --continue")
      console.error("")
      console.error("Or abort with:")
      console.error("  git reset --hard")
      console.error(`  git checkout ${originalBranch}`)
      process.exit(1)
    }
  }

  // Restore user's original rerere cache
  await restoreUserRerereCache(userRerereCachePath)

  await clearSyncState()
  console.log("")
  console.log(`Successfully applied ${applied} patch(es)`)
  console.log(`Build branch '${buildBranch}' is ready`)
}

function parsePatch(patchText: string): { message: string; diff: string; subject: string } {
  const lines = patchText.split("\n")
  const diffStart = lines.findIndex((line) => line.startsWith("diff --git "))

  if (diffStart === -1) {
    throw new Error("Invalid patch: missing diff content")
  }

  const subjectLine = lines.find((line) => line.startsWith("Subject: "))
  const fallbackSubject = subjectLine
    ? subjectLine.replace(/^Subject:\s*\[PATCH\]\s*/u, "").trim()
    : "apply patch"

  const headerEnd = lines.findIndex((line) => line.trim() === "")
  let messageLines: string[] = []

  if (headerEnd !== -1 && headerEnd < diffStart) {
    messageLines = lines.slice(headerEnd + 1, diffStart)
    while (messageLines.length > 0 && messageLines[messageLines.length - 1]?.trim() === "") {
      messageLines.pop()
    }
  }

  const message = messageLines.join("\n").trim() || fallbackSubject
  const subject = message.split("\n")[0] || fallbackSubject
  const diff = lines.slice(diffStart).join("\n")

  return { message, diff, subject }
}
