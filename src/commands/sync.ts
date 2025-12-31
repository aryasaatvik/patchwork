import { exec, execRaw, getRepoRoot, loadConfig, getCurrentBranch, resolvePatchDir } from "../git"
import { readdir } from "fs/promises"

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

    const result = await execRaw(`git am --3way "${patchPath}"`)

    if (result.exitCode !== 0) {
      console.error("")
      console.error(`Failed to apply ${patch}`)
      console.error("")
      console.error("Resolve conflicts, then run:")
      console.error("  git am --continue")
      console.error("")
      console.error("Or abort with:")
      console.error("  git am --abort")
      console.error(`  git checkout ${originalBranch}`)
      console.error("")
      console.error("After resolving, regenerate the patch:")
      console.error(`  git format-patch ${upstream}..HEAD --stdout > "${patchPath}"`)
      process.exit(1)
    }

    applied++
  }

  console.log("")
  console.log(`Successfully applied ${applied} patch(es)`)
  console.log(`Build branch '${buildBranch}' is ready`)
}
