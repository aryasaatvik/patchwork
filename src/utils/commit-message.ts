import { createOpencodeClient } from "@opencode-ai/sdk"
import COMMIT_MESSAGE_PROMPT from "../prompts/commit-message.md"

export type CommitType = "feat" | "fix" | "docs" | "style" | "refactor" | "test" | "chore"

export interface CommitMessage {
  type: CommitType
  scope?: string
  subject: string
  body?: string
  footer?: string
}

// OpenCode server configuration
const OPENCODE_PORT = 4096
const OPENCODE_URL = `http://127.0.0.1:${OPENCODE_PORT}`

/**
 * Check if OpenCode server is running
 */
export async function isOpencodeRunning(): Promise<boolean> {
  try {
    const response = await fetch(`${OPENCODE_URL}/api/config/providers`, {
      signal: AbortSignal.timeout(2000),
    })
    return response.ok
  } catch {
    return false
  }
}

/**
 * Generate a Conventional Commit message from a git diff using OpenCode AI
 */
export async function generateCommitMessage(
  diff: string,
  options?: { timeout?: number }
): Promise<CommitMessage | null> {
  const timeout = options?.timeout ?? 60_000

  // Truncate diff if too long (AI context limits)
  const maxDiffLength = 8000
  const truncatedDiff = diff.length > maxDiffLength
    ? diff.slice(0, maxDiffLength) + "\n... (truncated)"
    : diff

  try {
    const client = createOpencodeClient({ baseUrl: OPENCODE_URL })

    // Create session (follows Avaan pattern)
    const { data: session } = await client.session.create({
      body: { title: "Generate commit message" },
    })

    if (!session?.id) {
      throw new Error("Failed to create OpenCode session")
    }

    try {
      // Prompt the session
      const response = await client.session
        .prompt({
          path: { id: session.id },
          body: {
            model: { providerID: "anthropic", modelID: "claude-haiku-4-5" },
            tools: {
              "*": false,
            },
            parts: [
              {
                type: "text",
                text: `${COMMIT_MESSAGE_PROMPT}

Diff to analyze:
\`\`\`diff
${truncatedDiff}
\`\`\`
`,
              },
            ],
          },
          signal: AbortSignal.timeout(timeout),
        })

      // Extract text from response
      const responseData = response as { data?: { parts?: Array<{ type: string; text?: string }> } }
      const responseText =
        responseData?.data?.parts?.map((p) => (p.type === "text" ? p.text : "")).filter(Boolean).join("") || "{}"

      // Parse JSON
      let jsonString = responseText
      const codeBlockMatch = responseText.match(/```(?:json)?\s*([\s\S]*?)```/)
      if (codeBlockMatch && codeBlockMatch[1]) {
        jsonString = codeBlockMatch[1]
      }

      const parsed = JSON.parse(jsonString) as CommitMessage

      // Validate required fields
      if (!parsed.type || !parsed.subject) {
        return null
      }

      return parsed
    } finally {
      // Clean up session (follows Avaan pattern)
      await client.session.delete({ path: { id: session.id } }).catch(() => {})
    }
  } catch (error) {
    if (error instanceof Error && error.name === "TimeoutError") {
      console.warn("Commit message generation timed out")
    } else {
      console.warn("Failed to generate commit message:", error instanceof Error ? error.message : error)
    }
    return null
  }
}

/**
 * Format a CommitMessage as a Conventional Commit string
 */
export function formatConventionalCommit(message: CommitMessage): string {
  const scope = message.scope ? `(${message.scope})` : ""
  const header = `${message.type}${scope}: ${message.subject}`
  
  const parts: string[] = [header]
  
  if (message.body) {
    parts.push("", message.body)
  }
  
  if (message.footer) {
    parts.push("", message.footer)
  }
  
  return parts.join("\n")
}

/**
 * Generate a Conventional Commit string from a git diff
 */
export async function generateConventionalCommit(
  diff: string,
  options?: { timeout?: number }
): Promise<string | null> {
  const commitMessage = await generateCommitMessage(diff, options)
  
  if (!commitMessage) {
    return null
  }
  
  return formatConventionalCommit(commitMessage)
}
