import { getRepoRoot, loadConfig, saveConfig } from "../git"
import { listPatchRefs, deletePatchRef } from "../utils/patch-refs"

export async function drop(patchNames: string[]): Promise<void> {
  const repoRoot = await getRepoRoot()
  const { config, configDir } = await loadConfig(repoRoot)

  const patches = await listPatchRefs()

  let dropped = 0

  for (const patchName of patchNames) {
    const match = patches.find((p) => p === patchName || p.includes(patchName))

    if (!match) {
      console.warn(`Patch not found: ${patchName}`)
      continue
    }

    // Delete from refs
    await deletePatchRef(match)

    // Remove from config
    if (config.patches?.[match]) {
      delete config.patches[match]
    }

    console.log(`Dropped: ${match}`)
    dropped++
  }

  // Save updated config
  if (dropped > 0) {
    await saveConfig(configDir, config)
  }

  if (dropped === 0) {
    console.log("No patches dropped.")
  }
}
