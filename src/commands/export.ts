import { exec, getRepoRoot, loadConfig, saveConfig, type PatchMetadata } from "../git"
import { generateConventionalCommit, isOpencodeRunning } from "../utils/commit-message"
import { getCommitMessageFromPR, findPRForBranch, getPRDetails, isGHAvailable } from "../utils/github-pr"
import { storePatchRef, getNextPatchNumber, deletePatchRef } from "../utils/patch-refs"

export interface ExportOptions {
  dependsOn?: string[]
  upstreamPR?: string
  description?: string
}

export async function exportPatch(branch: string, options: ExportOptions = {}): Promise<void> {
  const repoRoot = await getRepoRoot()
  const { config, configDir } = await loadConfig(repoRoot)

  const upstream = `${config.upstream.remote}/${config.upstream.branch}`

  const commitCount = await exec(`git rev-list --count ${upstream}..${branch}`)
  if (commitCount === "0") {
    throw new Error(`Branch '${branch}' has no commits ahead of ${upstream}`)
  }

  const safeBranchName = branch.replace(/[^a-zA-Z0-9-]/g, "-")

  // Check if a patch for this branch already exists
  let patchName: string
  let existingPatchName: string | null = null

  for (const [name, metadata] of Object.entries(config.patches ?? {})) {
    if (metadata.sourceBranch === branch) {
      existingPatchName = name
      break
    }
  }

  if (existingPatchName) {
    // Update existing patch
    patchName = existingPatchName
    console.log(`Updating existing patch: ${patchName}`)
    await deletePatchRef(patchName)
  } else {
    // Create new patch
    const nextNumber = await getNextPatchNumber()
    const paddedNumber = String(nextNumber).padStart(3, "0")
    patchName = `${paddedNumber}-${safeBranchName}.patch`
  }

  // Get the diff for all commits (squashed patch)
  const diff = await exec(`git diff --binary $(git merge-base ${upstream} ${branch}) ${branch}`)

  // Generate commit message with priority: PR > AI > fallback
  let commitMessage: string | null = null
  let source = "fallback"

  // Priority 1: Try to get commit message from PR
  const prMessage = await getCommitMessageFromPR(branch)
  if (prMessage) {
    commitMessage = prMessage
    source = "pr"
    console.log("Using PR title and description for commit message")
  }

  // Priority 2: Try AI if no PR message
  if (!commitMessage && (await isOpencodeRunning())) {
    console.log("Generating commit message with AI...")
    commitMessage = await generateConventionalCommit(diff)
    if (commitMessage) {
      source = "ai"
      console.log("Generated commit message:")
      console.log(`  ${commitMessage.split("\n")[0]}`)
    }
  }

  // Priority 3: Fallback to branch name heuristic
  const fallbackMessage = createFallbackCommitMessage(branch, safeBranchName)
  const finalMessage = commitMessage ?? fallbackMessage

  if (source === "fallback") {
    console.log("No PR or AI available, using branch-based commit message")
  }

  // Create the patch content with proper headers
  const patchContent = createPatchWithMessage(branch, finalMessage, diff)

  // Store patch in git refs
  await storePatchRef(patchName, patchContent)

  // Capture current upstream HEAD for conflict resolution
  const baseCommit = await exec(`git rev-parse ${upstream}`)

  // Auto-detect PR URL if not specified
  let prUrl = options.upstreamPR
  if (!prUrl && (await isGHAvailable())) {
    const prNumber = await findPRForBranch(branch)
    if (prNumber) {
      const prDetails = await getPRDetails(prNumber)
      if (prDetails?.url) {
        prUrl = prDetails.url
        console.log(`Auto-detected PR: ${prUrl}`)
      }
    }
  }

  // Add to manifest
  const patchMetadata: PatchMetadata = {
    description: options.description ?? finalMessage.split("\n")[0],
    sourceBranch: branch,
    status: "active",
    baseCommit,
  }

  // When updating existing patch, preserve certain metadata if not overridden
  if (existingPatchName) {
    const existingMetadata = config.patches?.[existingPatchName]
    // Preserve dependencies if not overridden
    if (!options.dependsOn && existingMetadata?.dependencies) {
      patchMetadata.dependencies = existingMetadata.dependencies
    }
    // Preserve upstreamPR if not overridden
    if (!prUrl && existingMetadata?.upstreamPR) {
      patchMetadata.upstreamPR = existingMetadata.upstreamPR
    }
  }

  if (options.dependsOn && options.dependsOn.length > 0) {
    patchMetadata.dependencies = options.dependsOn
  }
  if (prUrl) {
    patchMetadata.upstreamPR = prUrl
  }

  // Update config with new patch
  config.patches = config.patches ?? {}
  config.patches[patchName] = patchMetadata
  await saveConfig(configDir, config)

  console.log(`Exported ${commitCount} commit(s) from '${branch}' to:`)
  console.log(`  refs/patchwork/patches/${patchName}`)
  console.log(`Commit: ${finalMessage.split("\n")[0]}`)

  if (options.dependsOn && options.dependsOn.length > 0) {
    console.log(`Dependencies: ${options.dependsOn.join(", ")}`)
  }
  if (prUrl) {
    console.log(`Upstream PR: ${prUrl}`)
  }
}

function createFallbackCommitMessage(branch: string, safeBranchName: string): string {
  const normalizedBranch = branch.replace(/[^a-zA-Z0-9/_-]/g, "-")
  const match = normalizedBranch.match(/^(feat|fix|docs|style|refactor|test|chore)[/-](.+)$/)
  const type = match?.[1] ?? "chore"
  const subjectSource = match?.[2] ?? safeBranchName
  const subject = subjectSource
    .replace(/[/-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()

  return `${type}: ${subject || "patch"}`
}

/**
 * Create a patch file with commit message header
 * Follows git format-patch conventions for git am compatibility
 */
function createPatchWithMessage(branch: string, commitMessage: string, diff: string): string {
  const lines: string[] = []

  // From line (simulating a commit)
  lines.push(`From ${branch} ${new Date().toISOString()}`)

  // Date line
  lines.push(`Date: ${new Date().toUTCString()}`)

  // Subject line
  const subject = commitMessage.split("\n")[0]
  lines.push(`Subject: [PATCH] ${subject}`)

  // From header (placeholder)
  lines.push(`From: Patchwork Export <patchwork@local>`)

  // New commit marker
  lines.push(`commit (patchwork export)`)

  // Commit message body
  lines.push("")
  for (const line of commitMessage.split("\n")) {
    lines.push(line)
  }

  // Blank line before diff
  lines.push("")

  // The diff content
  lines.push(diff)

  return lines.join("\n") + "\n"
}
