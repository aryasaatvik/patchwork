import { exec, getRepoRoot, loadConfig, resolvePatchDir } from "../git"
import { readdir, writeFile } from "fs/promises"
import { generateConventionalCommit, isOpencodeRunning } from "../utils/commit-message"

export async function exportPatch(branch: string): Promise<void> {
  const repoRoot = await getRepoRoot()
  const { config, configDir } = await loadConfig(repoRoot)
  const patchDir = resolvePatchDir(repoRoot, configDir, config.patchDir)

  const upstream = `${config.upstream.remote}/${config.upstream.branch}`

  const commitCount = await exec(`git rev-list --count ${upstream}..${branch}`)
  if (commitCount === "0") {
    throw new Error(`Branch '${branch}' has no commits ahead of ${upstream}`)
  }

  const existingPatches = await readdir(patchDir).catch(() => [])
  const patchNumbers = existingPatches
    .filter(f => f.endsWith(".patch"))
    .map(f => parseInt(f.split("-")[0] ?? "0", 10))
    .filter(n => !isNaN(n))
  
  const nextNumber = patchNumbers.length > 0 ? Math.max(...patchNumbers) + 1 : 1
  const paddedNumber = String(nextNumber).padStart(3, "0")

  const safeBranchName = branch.replace(/[^a-zA-Z0-9-]/g, "-")
  const patchName = `${paddedNumber}-${safeBranchName}.patch`
  const patchPath = `${patchDir}/${patchName}`

  // Get the diff for all commits (squashed patch)
  const diff = await exec(`git diff --binary $(git merge-base ${upstream} ${branch}) ${branch}`)

  // Generate AI commit message
  let commitMessage: string | null = null
  let aiMessageGenerated = false

  if (await isOpencodeRunning()) {
    console.log("Generating commit message with AI...")
    commitMessage = await generateConventionalCommit(diff)
    if (commitMessage) {
      aiMessageGenerated = true
      console.log("AI-generated commit message:")
      console.log(`  ${commitMessage.split("\n")[0]}`)
    }
  }

  // Fallback if AI failed or not available
  const fallbackMessage = createFallbackCommitMessage(branch, safeBranchName)
  const finalMessage = commitMessage ?? fallbackMessage
  if (!commitMessage && !aiMessageGenerated) {
    console.log("AI not available, using fallback commit message")
  }

  // Create the patch file with proper headers
  const patchContent = createPatchWithMessage(branch, finalMessage, diff)
  await writeFile(patchPath, patchContent)

  console.log(`Exported ${commitCount} commit(s) from '${branch}' to:`)
  console.log(`  ${patchPath}`)
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
