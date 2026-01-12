import { execRaw } from "../git"

export interface PRInfo {
  number: number
  title: string
  body: string
  state: "OPEN" | "CLOSED" | "MERGED"
  url: string
  isMergeable: boolean
}

/**
 * Check if GH CLI is available and authenticated
 */
export async function isGHAvailable(): Promise<boolean> {
  const result = await execRaw("gh api user --jq '.login' 2>/dev/null")
  return result.exitCode === 0
}

/**
 * Find PR number for a given branch
 * Returns null if no PR found or GH unavailable
 */
export async function findPRForBranch(branch: string): Promise<number | null> {
  // Try to find PR by branch head
  const result = await execRaw(
    `gh pr list --head "${branch}" --json number --jq '.[0].number' 2>/dev/null`
  )

  if (result.exitCode !== 0 || !result.stdout || result.stdout === "null") {
    return null
  }

  const prNumber = parseInt(result.stdout, 10)
  return isNaN(prNumber) ? null : prNumber
}

/**
 * Get full PR details including title, body, and state
 * Returns null if PR not found or GH unavailable
 */
export async function getPRDetails(prNumber: number): Promise<PRInfo | null> {
  const result = await execRaw(
    `gh pr view ${prNumber} --json number,title,body,state,url,mergeable --jq '{number: .number, title: .title, body: .body // "", state: .state, url: .url, isMergeable: .mergeable}' 2>/dev/null`
  )

  if (result.exitCode !== 0 || !result.stdout) {
    return null
  }

  try {
    const data = JSON.parse(result.stdout) as PRInfo
    if (!data.title) return null
    return data
  } catch {
    return null
  }
}

/**
 * Convert PR title and body to Conventional Commit format
 * Returns null if PR is closed or merged (no longer a patch candidate)
 */
export function formatPRAsCommit(pr: PRInfo): string | null {
  // Don't use closed/merged PRs as commit sources
  if (pr.state !== "OPEN") {
    return null
  }

  const title = pr.title.trim()
  if (!title) {
    return null
  }

  // Use PR title as-is (it's already the best commit message format)
  const parts: string[] = [title]

  // Add body as commit body if present
  if (pr.body && pr.body.trim()) {
    parts.push("")
    parts.push(pr.body.trim())
  }

  return parts.join("\n")
}

/**
 * Get commit message from PR for a branch
 * Returns null if no PR found or PR is not suitable
 */
export async function getCommitMessageFromPR(branch: string): Promise<string | null> {
  // Check if GH is available first
  if (!(await isGHAvailable())) {
    return null
  }

  // Find PR for this branch
  const prNumber = await findPRForBranch(branch)
  if (!prNumber) {
    return null
  }

  // Get PR details
  const pr = await getPRDetails(prNumber)
  if (!pr) {
    return null
  }

  // Format as commit message
  return formatPRAsCommit(pr)
}
