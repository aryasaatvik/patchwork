import { getRepoRoot, loadConfig, getCurrentBranch, resolvePatchDir } from "../git"
import { readdir, stat } from "fs/promises"

export async function status(): Promise<void> {
  const repoRoot = await getRepoRoot()
  const { config, configDir } = await loadConfig(repoRoot)
  const patchDir = resolvePatchDir(repoRoot, configDir, config.patchDir)
  const upstream = `${config.upstream.remote}/${config.upstream.branch}`

  console.log("Patchwork Status")
  console.log("================")
  console.log("")
  console.log(`Config: ${configDir}`)
  console.log(`Upstream: ${upstream}`)
  console.log(`Build branch: ${config.buildBranch}`)
  console.log(`Current branch: ${await getCurrentBranch()}`)
  console.log("")

  const patches = (await readdir(patchDir).catch(() => []))
    .filter(f => f.endsWith(".patch"))
    .sort()

  if (patches.length === 0) {
    console.log("No patches")
    return
  }

  console.log(`Patches (${patches.length}):`)
  for (const patch of patches) {
    const patchPath = `${patchDir}/${patch}`
    const stats = await stat(patchPath)
    const sizeKb = (stats.size / 1024).toFixed(1)
    console.log(`  ${patch} (${sizeKb} KB)`)
  }
}
