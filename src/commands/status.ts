import { getRepoRoot, loadConfig, getCurrentBranch } from "../git"
import { listPatchRefs, readPatchRef } from "../utils/patch-refs"

export async function status(): Promise<void> {
  const repoRoot = await getRepoRoot()
  const { config, configDir } = await loadConfig(repoRoot)
  const upstream = `${config.upstream.remote}/${config.upstream.branch}`

  console.log("Patchwork Status")
  console.log("================")
  console.log("")
  console.log(`Config: ${configDir}`)
  console.log(`Upstream: ${upstream}`)
  console.log(`Build branch: ${config.buildBranch}`)
  console.log(`Current branch: ${await getCurrentBranch()}`)
  console.log(`Excluded from sync: ${config.exclude?.join(", ") ?? ".patchwork"}`)
  console.log("")

  const patchNames = await listPatchRefs()

  if (patchNames.length === 0) {
    console.log("No patches")
    return
  }

  console.log(`Patches (${patchNames.length}):`)
  for (const patchName of patchNames.sort()) {
    const metadata = config.patches?.[patchName]
    const status = metadata?.status ?? "active"
    const statusIcon = status === "active" ? "●" : status === "merged" ? "✓" : "○"

    // Get patch size
    let sizeInfo = ""
    try {
      const content = await readPatchRef(patchName)
      const sizeKb = (content.length / 1024).toFixed(1)
      sizeInfo = ` (${sizeKb} KB)`
    } catch {
      sizeInfo = ""
    }

    console.log(`  ${statusIcon} ${patchName}${sizeInfo}`)

    if (metadata?.description) {
      console.log(`      ${metadata.description}`)
    }
    if (metadata?.upstreamPR) {
      console.log(`      PR: ${metadata.upstreamPR}`)
    }
    if (metadata?.dependencies && metadata.dependencies.length > 0) {
      console.log(`      Depends on: ${metadata.dependencies.join(", ")}`)
    }
  }
}
