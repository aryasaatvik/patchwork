import { exec, getRepoRoot, loadConfig } from "../git"
import { readdir } from "fs/promises"

export async function exportPatch(branch: string): Promise<void> {
  const repoRoot = await getRepoRoot()
  const config = await loadConfig(repoRoot)
  const patchDir = `${repoRoot}/${config.patchDir}`

  const upstream = `${config.upstream.remote}/${config.upstream.branch}`

  const commitCount = await exec(`git rev-list --count ${upstream}..${branch}`)
  if (commitCount === "0") {
    throw new Error(`Branch '${branch}' has no commits ahead of ${upstream}`)
  }

  const existingPatches = await readdir(patchDir).catch(() => [])
  const patchNumbers = existingPatches
    .filter(f => f.endsWith(".patch"))
    .map(f => parseInt(f.split("-")[0] ?? "0", 10))
    .filter(n => !isNaN(n))
  
  const nextNumber = patchNumbers.length > 0 ? Math.max(...patchNumbers) + 1 : 1
  const paddedNumber = String(nextNumber).padStart(3, "0")

  const safeBranchName = branch.replace(/[^a-zA-Z0-9-]/g, "-")
  const patchName = `${paddedNumber}-${safeBranchName}.patch`
  const patchPath = `${patchDir}/${patchName}`

  await exec(`git format-patch ${upstream}..${branch} --stdout > "${patchPath}"`)

  console.log(`Exported ${commitCount} commit(s) from '${branch}' to:`)
  console.log(`  ${config.patchDir}/${patchName}`)
}
