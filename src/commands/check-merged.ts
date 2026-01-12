import { getRepoRoot, loadConfig, saveConfig } from "../git"
import { listPatchRefs } from "../utils/patch-refs"

interface PRStatus {
  patch: string
  prUrl: string
  state: "open" | "merged" | "closed"
  merged: boolean
  title?: string
}

/**
 * Parse GitHub PR URL to extract owner, repo, and PR number
 */
function parsePRUrl(url: string): { owner: string; repo: string; number: number } | null {
  // Handle formats:
  // https://github.com/owner/repo/pull/123
  // github.com/owner/repo/pull/123
  const match = url.match(/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/)
  if (!match) return null
  return {
    owner: match[1]!,
    repo: match[2]!,
    number: parseInt(match[3]!, 10),
  }
}

/**
 * Check PR status using GitHub CLI (gh)
 */
async function checkPRStatus(prUrl: string): Promise<PRStatus | null> {
  const parsed = parsePRUrl(prUrl)
  if (!parsed) {
    console.warn(`  Warning: Could not parse PR URL: ${prUrl}`)
    return null
  }

  const { owner, repo, number } = parsed

  try {
    const proc = Bun.spawn(
      ["gh", "api", `repos/${owner}/${repo}/pulls/${number}`, "--jq", ".state,.merged,.title"],
      {
        stdout: "pipe",
        stderr: "pipe",
      }
    )

    const stdout = await new Response(proc.stdout).text()
    const stderr = await new Response(proc.stderr).text()
    const exitCode = await proc.exited

    if (exitCode !== 0) {
      console.warn(`  Warning: Failed to check PR #${number}: ${stderr.trim()}`)
      return null
    }

    const lines = stdout.trim().split("\n")
    const state = lines[0] as "open" | "merged" | "closed"
    const merged = lines[1] === "true"
    const title = lines[2]

    return {
      patch: "",
      prUrl,
      state,
      merged,
      title,
    }
  } catch (error) {
    console.warn(`  Warning: Error checking PR: ${error}`)
    return null
  }
}

export async function checkMerged(options: { autoUpdate?: boolean } = {}): Promise<void> {
  const repoRoot = await getRepoRoot()
  const { config, configDir } = await loadConfig(repoRoot)

  const patches = await listPatchRefs()

  if (patches.length === 0) {
    console.log("No patches found.")
    return
  }

  // Find patches with upstream PRs
  const patchesWithPRs: { patch: string; prUrl: string; currentStatus: string }[] = []

  for (const patch of patches.sort()) {
    const metadata = config.patches?.[patch]
    if (metadata?.upstreamPR) {
      patchesWithPRs.push({
        patch,
        prUrl: metadata.upstreamPR,
        currentStatus: metadata.status ?? "active",
      })
    }
  }

  if (patchesWithPRs.length === 0) {
    console.log("No patches have upstream PRs configured.")
    console.log("")
    console.log("To track a PR, use:")
    console.log("  ptchwrk deps set-pr <patch> <pr-url>")
    return
  }

  console.log(`Checking ${patchesWithPRs.length} patch(es) with upstream PRs...`)
  console.log("")

  const results: { patch: string; status: PRStatus | null; currentStatus: string }[] = []
  const mergedPatches: string[] = []

  for (const { patch, prUrl, currentStatus } of patchesWithPRs) {
    console.log(`Checking ${patch}...`)
    const status = await checkPRStatus(prUrl)
    if (status) {
      status.patch = patch
    }
    results.push({ patch, status, currentStatus })

    if (status?.merged && currentStatus !== "merged") {
      mergedPatches.push(patch)
    }
  }

  console.log("")
  console.log("Results")
  console.log("=======")
  console.log("")

  for (const { patch, status, currentStatus } of results) {
    if (!status) {
      console.log(`${patch}: ⚠️  Could not check status`)
      continue
    }

    const prNumber = parsePRUrl(status.prUrl)?.number
    const prLabel = prNumber ? `PR #${prNumber}` : status.prUrl

    if (status.merged) {
      if (currentStatus === "merged") {
        console.log(`${patch}: ✅ ${prLabel} merged (already marked)`)
      } else {
        console.log(`${patch}: 🎉 ${prLabel} merged! (needs update)`)
      }
    } else if (status.state === "closed") {
      console.log(`${patch}: ❌ ${prLabel} closed without merge`)
    } else {
      console.log(`${patch}: ⏳ ${prLabel} still open`)
    }

    if (status.title) {
      console.log(`   "${status.title}"`)
    }
  }

  if (mergedPatches.length > 0) {
    console.log("")

    if (options.autoUpdate) {
      console.log("Updating patch statuses...")
      for (const patch of mergedPatches) {
        config.patches = config.patches ?? {}
        config.patches[patch] = config.patches[patch] ?? {}
        config.patches[patch]!.status = "merged"
        console.log(`  ✅ Marked ${patch} as merged`)
      }
      await saveConfig(configDir, config)
      console.log("")
      console.log("Run 'ptchwrk sync' to rebuild without merged patches.")
    } else {
      console.log("To mark these patches as merged, run:")
      for (const patch of mergedPatches) {
        console.log(`  ptchwrk deps set-status ${patch} merged`)
      }
      console.log("")
      console.log("Or run with --update to automatically update:")
      console.log("  ptchwrk check-merged --update")
    }
  }
}
