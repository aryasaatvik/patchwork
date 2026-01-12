import { getRepoRoot, loadConfig } from "../git"
import { writeFile } from "fs/promises"
import { join } from "path"
import {
  isOpencodeRunning,
  resolveConflict,
  extractConflictContext,
} from "../utils/conflict/resolver"
import { listPatchRefs, readPatchRef } from "../utils/patch-refs"

export interface ResolveOptions {
  patch?: string // Specific patch to resolve (optional)
  dryRun?: boolean // Don't write files, just show what would change
  auto?: boolean // Automatically stage resolved files
}

export async function resolve(options: ResolveOptions = {}): Promise<void> {
  const repoRoot = await getRepoRoot()
  const { config } = await loadConfig(repoRoot)

  // Check if OpenCode is running
  console.log("Checking OpenCode server...")
  if (!(await isOpencodeRunning())) {
    console.error("Error: OpenCode server is not running")
    console.error("")
    console.error("Please start OpenCode first:")
    console.error("  opencode")
    console.error("")
    console.error("Or run in the background:")
    console.error("  opencode --background")
    process.exit(1)
  }
  console.log("OpenCode server is running")
  console.log("")

  // Detect which patch is currently being applied (if any)
  let patchName = options.patch
  let patchContent: string
  let patchDescription: string

  const allPatches = await listPatchRefs()

  if (patchName) {
    // User specified a patch - find it
    const match = allPatches.find((p) => p === patchName || p.includes(patchName!))
    if (!match) {
      console.error(`Error: Patch not found: ${patchName}`)
      process.exit(1)
    }
    patchName = match

    patchContent = await readPatchRef(patchName)
    const metadata = config.patches?.[patchName]
    patchDescription = metadata?.description ?? patchName
  } else {
    // Try to detect from git state or current sync context
    console.log("No patch specified. Looking for active conflict...")

    // Check if there are conflict markers
    const proc = Bun.spawn(["git", "diff", "--name-only", "--diff-filter=U"], {
      cwd: repoRoot,
      stdout: "pipe",
      stderr: "pipe",
    })

    const stdout = await new Response(proc.stdout).text()
    const exitCode = await proc.exited

    if (exitCode !== 0 || !stdout.trim()) {
      // Try finding files with conflict markers
      const grepProc = Bun.spawn(["grep", "-rl", "^<<<<<<<", "."], {
        cwd: repoRoot,
        stdout: "pipe",
        stderr: "pipe",
      })

      const grepOut = await new Response(grepProc.stdout).text()
      await grepProc.exited

      if (!grepOut.trim()) {
        console.log("No conflicts detected.")
        console.log("")
        console.log("Usage: ptchwrk resolve [--patch <name>]")
        console.log("")
        console.log("Run this command after a conflict occurs during 'ptchwrk sync'")
        return
      }
    }

    // We have conflicts, but we need to know which patch
    // Use the first active patch as a guess
    const activePatches = allPatches.filter((p) => {
      const metadata = config.patches?.[p]
      return (metadata?.status ?? "active") === "active"
    })

    if (activePatches.length === 0) {
      console.error("Error: No active patches found")
      process.exit(1)
    }

    // Use the first active patch as a guess
    patchName = activePatches.sort()[0]!
    patchContent = await readPatchRef(patchName)
    const metadata = config.patches?.[patchName]
    patchDescription = metadata?.description ?? patchName

    console.log(`Assuming conflict is from patch: ${patchName}`)
    console.log("(Use --patch <name> to specify a different patch)")
    console.log("")
  }

  // Get patch metadata for baseCommit
  const patchMetadata = config.patches?.[patchName]
  const baseCommit = patchMetadata?.baseCommit

  console.log(`Resolving conflicts for: ${patchName}`)
  console.log(`Description: ${patchDescription}`)
  if (baseCommit) {
    console.log(`Base commit: ${baseCommit.slice(0, 8)}`)
  }
  console.log("")

  // Extract conflict context
  console.log("Extracting conflict context...")
  const context = await extractConflictContext(repoRoot, patchName, patchContent, patchDescription)

  if (context.conflictingFiles.length === 0) {
    console.log("No conflicting files found.")
    return
  }

  console.log(`Found ${context.conflictingFiles.length} conflicting file(s):`)
  for (const file of context.conflictingFiles) {
    console.log(`  - ${file}`)
  }
  console.log("")

  // Resolve conflicts using multi-step analysis
  const resolution = await resolveConflict(context, baseCommit)

  if (!resolution) {
    console.error("Error: Failed to generate a resolution")
    console.error("")
    console.error("You may need to resolve this conflict manually:")
    console.error("  1. Edit the conflicting files to resolve markers")
    console.error("  2. Run: git add -A")
    console.error('  3. Run: git commit -m "<commit message>"')
    process.exit(1)
  }

  console.log("Resolution")
  console.log("==========")
  console.log("")
  console.log(resolution.explanation)
  console.log("")

  // Show or apply the resolution
  const resolvedFiles = Object.keys(resolution.files)
  console.log(`Resolved ${resolvedFiles.length} file(s):`)
  for (const file of resolvedFiles) {
    console.log(`  - ${file}`)
  }
  console.log("")

  if (options.dryRun) {
    console.log("[Dry run - not writing files]")
    console.log("")
    console.log("Proposed changes:")
    for (const [file, content] of Object.entries(resolution.files)) {
      console.log(`\n=== ${file} ===`)
      // Show first 50 lines as preview
      const lines = content.split("\n")
      const preview = lines.slice(0, 50).join("\n")
      console.log(preview)
      if (lines.length > 50) {
        console.log(`... (${lines.length - 50} more lines)`)
      }
    }
    return
  }

  // Write the resolved files
  console.log("Writing resolved files...")
  for (const [file, content] of Object.entries(resolution.files)) {
    const filePath = join(repoRoot, file)
    await writeFile(filePath, content)
    console.log(`  ✓ ${file}`)
  }
  console.log("")

  if (options.auto) {
    console.log("Staging resolved files...")
    const proc = Bun.spawn(["git", "add", ...resolvedFiles], {
      cwd: repoRoot,
      stdout: "pipe",
      stderr: "pipe",
    })
    await proc.exited
    console.log("")
  }

  console.log("Next steps:")
  if (!options.auto) {
    console.log("  1. Review the resolved files")
    console.log("  2. Run: git add -A")
  } else {
    console.log("  1. Review the staged changes")
  }
  console.log('  2. Run: git commit -m "<commit message>"')
  console.log("  3. Continue with remaining patches or push")
}
