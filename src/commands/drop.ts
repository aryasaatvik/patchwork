import { getRepoRoot, loadConfig, resolvePatchDir } from "../git"
import { readdir, unlink } from "fs/promises"

export async function drop(patchNames: string[]): Promise<void> {
  const repoRoot = await getRepoRoot()
  const { config, configDir } = await loadConfig(repoRoot)
  const patchDir = resolvePatchDir(repoRoot, configDir, config.patchDir)

  const patches = (await readdir(patchDir).catch(() => []))
    .filter(f => f.endsWith(".patch"))

  let dropped = 0

  for (const patchName of patchNames) {
    const match = patches.find(p => p === patchName || p.includes(patchName))
    
    if (!match) {
      console.warn(`Patch not found: ${patchName}`)
      continue
    }

    const patchPath = `${patchDir}/${match}`
    await unlink(patchPath)
    console.log(`Dropped: ${match}`)
    dropped++
  }

  if (dropped === 0) {
    console.log("No patches dropped.")
  }
}
