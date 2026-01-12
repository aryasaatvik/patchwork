import { getRepoRoot, getRepoIdentifier, getDataDir, saveConfig, type PatchworkConfig } from "../git"
import { mkdir } from "fs/promises"

export async function init(tracked: boolean = false): Promise<void> {
  const repoRoot = await getRepoRoot()

  let configDir: string
  if (tracked) {
    configDir = `${repoRoot}/.patchwork`
  } else {
    const repoId = await getRepoIdentifier(repoRoot)
    configDir = `${getDataDir()}/${repoId}`
  }

  const configPath = `${configDir}/config.json`
  const configFile = Bun.file(configPath)

  if (await configFile.exists()) {
    console.log("Patchwork already initialized")
    console.log(`  Config: ${configDir}`)
    return
  }

  await mkdir(configDir, { recursive: true })

  // Only set required fields - Zod schema provides defaults for optional fields
  const config: PatchworkConfig = {
    upstream: {
      remote: "origin",
      branch: "main",
    },
    buildBranch: "patchwork-build",
    remote: "origin",
    exclude: [".patchwork"],
    patches: {},
  }

  await saveConfig(configDir, config)

  console.log("Initialized Patchwork")
  console.log("")
  console.log(`Config: ${configPath}`)
  console.log(`Patches: stored in git refs (refs/patchwork/patches/*)`)
  console.log("")
  console.log(`Upstream: ${config.upstream.remote}/${config.upstream.branch}`)
  console.log(`Build branch: ${config.buildBranch}`)
  console.log(`Remote: ${config.remote}`)
  console.log(`Excluded from sync: ${config.exclude.join(", ")}`)
  console.log("")
  console.log(`Edit ${configPath} to customize.`)
}
