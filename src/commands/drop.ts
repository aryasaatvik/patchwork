import { getRepoRoot, loadConfig } from "../git"
import { readdir, unlink } from "fs/promises"

export async function drop(patchName: string): Promise<void> {
  const repoRoot = await getRepoRoot()
  const config = await loadConfig(repoRoot)
  const patchDir = `${repoRoot}/${config.patchDir}`

  const patches = (await readdir(patchDir).catch(() => []))
    .filter(f => f.endsWith(".patch"))

  const match = patches.find(p => p === patchName || p.includes(patchName))
  
  if (!match) {
    console.error(`Patch not found: ${patchName}`)
    console.error("")
    console.error("Available patches:")
    for (const p of patches) {
      console.error(`  ${p}`)
    }
    process.exit(1)
  }

  const patchPath = `${patchDir}/${match}`
  await unlink(patchPath)

  console.log(`Dropped: ${match}`)
}
