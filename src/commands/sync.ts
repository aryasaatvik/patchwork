import { exec, execRaw, getRepoRoot, loadConfig, getCurrentBranch, resolvePatchDir } from "../git"
import { readdir, readFile, writeFile, rm, mkdtemp } from "fs/promises"
import { join } from "path"
import { tmpdir } from "os"

export async function sync(): Promise<void> {
  const repoRoot = await getRepoRoot()
  const { config, configDir } = await loadConfig(repoRoot)
  const patchDir = resolvePatchDir(repoRoot, configDir, config.patchDir)
  const upstream = `${config.upstream.remote}/${config.upstream.branch}`
  const originalBranch = await getCurrentBranch()

  console.log(`Fetching ${config.upstream.remote}...`)
  await exec(`git fetch ${config.upstream.remote}`)

  const patches = (await readdir(patchDir).catch(() => []))
    .filter(f => f.endsWith(".patch"))
    .sort()

  if (patches.length === 0) {
    console.log("No patches to apply.")
    return
  }

  console.log(`Found ${patches.length} patch(es)`)
  console.log("")

  const buildBranch = config.buildBranch

  console.log(`Creating ${buildBranch} from ${upstream}...`)
  await exec(`git checkout -B ${buildBranch} ${upstream}`)

  let applied = 0
  for (const patch of patches) {
    const patchPath = `${patchDir}/${patch}`
    console.log(`Applying ${patch}...`)

    const patchText = await readFile(patchPath, "utf-8")
    const { message, diff, subject } = parsePatch(patchText)
    const tempDir = await mkdtemp(join(tmpdir(), "patchwork-"))
    const diffPath = join(tempDir, "patch.diff")
    const messagePath = join(tempDir, "patch-message.txt")

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
      await rm(tempDir, { recursive: true, force: true })
    }

    if (!applyResult || applyResult.exitCode !== 0) {
      const safeSubject = subject.replace(/"/g, "\\\"")

      console.error("")
      console.error(`Failed to apply ${patch}`)
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
