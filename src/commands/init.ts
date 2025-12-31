import { getRepoRoot, saveConfig, type PatchworkConfig } from "../git"
import { mkdir } from "fs/promises"

export async function init(): Promise<void> {
  const repoRoot = await getRepoRoot()
  const patchworkDir = `${repoRoot}/.patchwork`
  const patchDir = `${patchworkDir}/patches`

  const configPath = `${patchworkDir}/config.json`
  const configFile = Bun.file(configPath)
  
  if (await configFile.exists()) {
    console.log("Patchwork already initialized in this repository")
    return
  }

  await mkdir(patchDir, { recursive: true })

  const config: PatchworkConfig = {
    upstream: {
      remote: "origin",
      branch: "main",
    },
    buildBranch: "patchwork-build",
    patchDir: ".patchwork/patches",
  }

  await saveConfig(repoRoot, config)

  console.log("Initialized patchwork in", repoRoot)
  console.log("")
  console.log("Default config:")
  console.log(`  Upstream: ${config.upstream.remote}/${config.upstream.branch}`)
  console.log(`  Build branch: ${config.buildBranch}`)
  console.log(`  Patch directory: ${config.patchDir}`)
  console.log("")
  console.log("Edit .patchwork/config.json to customize.")
}
