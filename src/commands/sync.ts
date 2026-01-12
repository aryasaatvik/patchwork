import { exec, execRaw, getRepoRoot, loadConfig, getCurrentBranch } from "../git"
import { readFile, writeFile, rm, mkdtemp, cp } from "fs/promises"
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

export async function sync(): Promise<void> {
  const repoRoot = await getRepoRoot()
  const { config, configDir } = await loadConfig(repoRoot)
  const upstream = `${config.upstream.remote}/${config.upstream.branch}`
  const originalBranch = await getCurrentBranch()

  console.log(`Fetching ${config.upstream.remote}...`)
  await exec(`git fetch ${config.upstream.remote}`)

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

    try {
      await writeFile(diffPath, `${diff}\n`)
      await writeFile(messagePath, `${message}\n`)

      applyResult = await execRaw(`git apply --3way "${diffPath}"`)

      if (applyResult.exitCode === 0) {
        await exec("git add -A")
        await exec(`git commit -F "${messagePath}"`)
        applied++
      }
    } finally {
      await rm(patchTempDir, { recursive: true, force: true })
    }

    if (!applyResult || applyResult.exitCode !== 0) {
      const safeSubject = subject.replace(/"/g, '\\"')

      console.error("")
      console.error(`Failed to apply ${patchName}`)
      console.error("")
      console.error("Resolve conflicts, then run:")
      console.error("  git add -A")
      console.error(`  git commit -m "${safeSubject}"`)
      console.error("")
      console.error("Or abort with:")
      console.error("  git reset --hard")
      console.error(`  git checkout ${originalBranch}`)
      process.exit(1)
    }
  }

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
