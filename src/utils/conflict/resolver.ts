import { createOpencodeClient } from "@opencode-ai/sdk"
import { readFile } from "fs/promises"
import { join } from "path"
import { exec } from "../../git"
import { renderPrompt } from "../prompt-template"
import ANALYZE_COMMIT_PROMPT from "../../prompts/analyze-commit.md" with { type: "text" }
import RESOLVE_CONFLICT_PROMPT from "../../prompts/resolve-conflict.md" with { type: "text" }

// OpenCode server configuration
const OPENCODE_PORT = 4096
const OPENCODE_URL = `http://127.0.0.1:${OPENCODE_PORT}`

// Model configuration
const ANALYSIS_MODEL = { providerID: "google", modelID: "gemini-3-flash-preview" }
const BATCH_SIZE = 5

export interface ConflictContext {
  patchName: string
  patchDescription: string
  patchDiff: string
  conflictingFiles: string[]
  fileContents: Record<string, string>
}

export interface ResolvedFiles {
  files: Record<string, string>
  explanation: string
}

interface CommitInfo {
  hash: string
  message: string
  diff: string
}

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
 * Get upstream commits since the base commit
 */
async function getUpstreamCommits(baseCommit: string): Promise<CommitInfo[]> {
  const log = await exec(`git log ${baseCommit}..HEAD --format="%H %s" --reverse`)

  if (!log.trim()) {
    return []
  }

  const commits: CommitInfo[] = []
  for (const line of log.split("\n").filter(Boolean)) {
    const spaceIndex = line.indexOf(" ")
    const hash = line.slice(0, spaceIndex)
    const message = line.slice(spaceIndex + 1)
    const diff = await exec(`git show ${hash} --format="" --patch`)
    commits.push({ hash, message, diff })
  }

  return commits
}

/**
 * Get a reasonable default base commit if none is provided
 */
async function getDefaultBase(): Promise<string> {
  // Try to get HEAD~20 or fall back to first commit
  try {
    return await exec("git rev-parse HEAD~20")
  } catch {
    // If repo has fewer than 20 commits, get the first commit
    return await exec("git rev-list --max-parents=0 HEAD")
  }
}

/**
 * Analyze a batch of commits using AI
 */
async function analyzeCommitBatch(
  client: ReturnType<typeof createOpencodeClient>,
  sessionId: string,
  commits: CommitInfo[]
): Promise<void> {
  const commitBatch = commits
    .map(
      (c) => `### Commit: ${c.hash.slice(0, 8)}
**Message:** ${c.message}

\`\`\`diff
${c.diff}
\`\`\``
    )
    .join("\n\n---\n\n")

  const prompt = renderPrompt(ANALYZE_COMMIT_PROMPT, { commitBatch })

  await client.session.prompt({
    path: { id: sessionId },
    body: {
      model: ANALYSIS_MODEL,
      tools: { "*": false },
      parts: [{ type: "text", text: prompt }],
    },
  })
}

/**
 * Present the conflict context and get a resolution
 */
async function presentConflict(
  client: ReturnType<typeof createOpencodeClient>,
  sessionId: string,
  context: ConflictContext
): Promise<ResolvedFiles | null> {
  const fileContentsSection = Object.entries(context.fileContents)
    .map(([path, content]) => `### ${path}\n\`\`\`\n${content}\n\`\`\``)
    .join("\n\n")

  const prompt = renderPrompt(RESOLVE_CONFLICT_PROMPT, {
    patchName: context.patchName,
    patchDescription: context.patchDescription,
    patchDiff: context.patchDiff,
    conflictingFiles: context.conflictingFiles.map((f) => `- ${f}`).join("\n"),
    fileContents: fileContentsSection,
  })

  const response = await client.session.prompt({
    path: { id: sessionId },
    body: {
      model: ANALYSIS_MODEL,
      tools: { "*": false },
      parts: [{ type: "text", text: prompt }],
    },
  })

  // Extract text from response
  const responseData = response as {
    data?: { parts?: Array<{ type: string; text?: string }> }
  }
  const responseText =
    responseData?.data?.parts
      ?.map((p) => (p.type === "text" ? p.text : ""))
      .filter(Boolean)
      .join("") || "{}"

  // Parse JSON
  let jsonString = responseText
  const codeBlockMatch = responseText.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (codeBlockMatch && codeBlockMatch[1]) {
    jsonString = codeBlockMatch[1]
  }

  try {
    const parsed = JSON.parse(jsonString) as ResolvedFiles

    if (!parsed.files || typeof parsed.files !== "object") {
      console.error("Invalid response: missing files object")
      return null
    }

    return parsed
  } catch (error) {
    console.error("Failed to parse resolution response:", error)
    return null
  }
}

/**
 * Resolve a merge conflict using multi-step AI analysis.
 *
 * This approach:
 * 1. Gets all upstream commits since the patch was created
 * 2. Analyzes them in batches to build context
 * 3. Presents the conflict with full understanding of upstream changes
 */
export async function resolveConflict(
  context: ConflictContext,
  baseCommit?: string
): Promise<ResolvedFiles | null> {
  const client = createOpencodeClient({ baseUrl: OPENCODE_URL })

  // Get upstream commits
  const base = baseCommit ?? (await getDefaultBase())
  let commits: CommitInfo[]

  try {
    commits = await getUpstreamCommits(base)
  } catch (error) {
    console.warn("Failed to get upstream commits:", error)
    commits = []
  }

  console.log(
    `Found ${commits.length} upstream commit(s) since base (${base.slice(0, 8)})`
  )

  // Create session
  const { data: session } = await client.session.create({
    body: { title: `Resolve conflict: ${context.patchName}` },
  })

  if (!session?.id) {
    throw new Error("Failed to create OpenCode session")
  }

  try {
    // Analyze commits in batches
    if (commits.length > 0) {
      for (let i = 0; i < commits.length; i += BATCH_SIZE) {
        const batch = commits.slice(i, i + BATCH_SIZE)
        const batchEnd = Math.min(i + BATCH_SIZE, commits.length)
        console.log(`Analyzing commits ${i + 1}-${batchEnd}...`)

        // Log commit messages for visibility
        for (const c of batch) {
          console.log(`  - ${c.message.slice(0, 60)}${c.message.length > 60 ? "..." : ""}`)
        }

        await analyzeCommitBatch(client, session.id, batch)
      }
    } else {
      console.log("No upstream commits to analyze, proceeding to resolution...")
    }

    // Present conflict and get resolution
    console.log("Requesting resolution...")
    return await presentConflict(client, session.id, context)
  } finally {
    // Clean up session
    await client.session.delete({ path: { id: session.id } }).catch(() => {})
  }
}

/**
 * Extract conflict context from the current git state
 */
export async function extractConflictContext(
  repoRoot: string,
  patchName: string,
  patchContent: string,
  patchDescription: string
): Promise<ConflictContext> {
  // Use the patch content directly
  const patchDiff = patchContent

  // Find files with conflict markers
  let conflictOutput = ""
  try {
    conflictOutput = await exec("git diff --name-only --diff-filter=U")
  } catch {
    // Fallback: search for conflict markers
    try {
      conflictOutput = await exec("grep -rl '^<<<<<<<' . 2>/dev/null || true")
    } catch {
      conflictOutput = ""
    }
  }

  const conflictingFiles = conflictOutput
    .split("\n")
    .map((f) => f.trim())
    .filter(Boolean)

  // Read the content of conflicting files
  const fileContents: Record<string, string> = {}
  for (const file of conflictingFiles) {
    try {
      const filePath = join(repoRoot, file)
      fileContents[file] = await readFile(filePath, "utf-8")
    } catch {
      fileContents[file] = "(unable to read file)"
    }
  }

  return {
    patchName,
    patchDescription,
    patchDiff,
    conflictingFiles,
    fileContents,
  }
}
