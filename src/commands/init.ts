import { getRepoRoot, getRepoIdentifier, getDataDir, saveConfig, type PatchworkConfig } from "../git"
import { mkdir } from "fs/promises"

export async function init(tracked: boolean = false): Promise<void> {
  const repoRoot = await getRepoRoot()
  
  let configDir: string
  if (tracked) {
    configDir = `${repoRoot}/.ptchwrk`
  } else {
    const repoId = await getRepoIdentifier(repoRoot)
    configDir = `${getDataDir()}/${repoId}`
  }
  
  const patchDir = `${configDir}/patches`
  const configPath = `${configDir}/config.json`
  const configFile = Bun.file(configPath)
  
  if (await configFile.exists()) {
    console.log("Patchwork already initialized")
    console.log(`  Config: ${configDir}`)
    return
  }

  await mkdir(patchDir, { recursive: true })

  const config: PatchworkConfig = {
    upstream: {
      remote: "origin",
      branch: "main",
    },
    buildBranch: "patchwork-build",
    patchDir: "patches",
  }

  await saveConfig(configDir, config)

  console.log("Initialized Patchwork")
  console.log("")
  console.log(`Config: ${configDir}`)
  console.log(`Patches: ${patchDir}`)
  console.log("")
  console.log(`Upstream: ${config.upstream.remote}/${config.upstream.branch}`)
  console.log(`Build branch: ${config.buildBranch}`)
  console.log("")
  console.log(`Edit ${configPath} to customize.`)
}
