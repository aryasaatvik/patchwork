import { getRepoRoot, loadConfig, saveConfig } from "../git"
import { listPatchRefs } from "../utils/patch-refs"
import { buildDependencyGraph, topologicalSort, renderGraph, getDependents } from "../utils/graph"

export async function addDependency(patch: string, dependsOn: string): Promise<void> {
  const repoRoot = await getRepoRoot()
  const { config, configDir } = await loadConfig(repoRoot)

  // Verify both patches exist
  const patches = await listPatchRefs()

  if (!patches.includes(patch)) {
    throw new Error(`Patch "${patch}" not found`)
  }
  if (!patches.includes(dependsOn)) {
    throw new Error(`Dependency "${dependsOn}" not found`)
  }
  if (patch === dependsOn) {
    throw new Error("A patch cannot depend on itself")
  }

  // Initialize patches manifest if needed
  config.patches = config.patches ?? {}
  config.patches[patch] = config.patches[patch] ?? {}

  const deps = config.patches[patch]!.dependencies ?? []
  if (deps.includes(dependsOn)) {
    console.log(`"${patch}" already depends on "${dependsOn}"`)
    return
  }

  // Check for circular dependency
  const testDeps = [...deps, dependsOn]
  config.patches[patch]!.dependencies = testDeps

  try {
    const graph = buildDependencyGraph(patches, config.patches)
    topologicalSort(graph) // This will throw if there's a cycle
  } catch (err) {
    // Revert
    config.patches[patch]!.dependencies = deps.length > 0 ? deps : undefined
    throw new Error(`Adding this dependency would create a cycle: ${patch} -> ${dependsOn}`)
  }

  await saveConfig(configDir, config)
  console.log(`Added dependency: "${patch}" now depends on "${dependsOn}"`)
}

export async function removeDependency(patch: string, dependsOn: string): Promise<void> {
  const repoRoot = await getRepoRoot()
  const { config, configDir } = await loadConfig(repoRoot)

  if (!config.patches?.[patch]) {
    throw new Error(`Patch "${patch}" has no metadata`)
  }

  const deps = config.patches[patch]!.dependencies ?? []
  if (!deps.includes(dependsOn)) {
    console.log(`"${patch}" does not depend on "${dependsOn}"`)
    return
  }

  config.patches[patch]!.dependencies = deps.filter((d) => d !== dependsOn)
  if (config.patches[patch]!.dependencies!.length === 0) {
    delete config.patches[patch]!.dependencies
  }

  await saveConfig(configDir, config)
  console.log(`Removed dependency: "${patch}" no longer depends on "${dependsOn}"`)
}

export async function showGraph(): Promise<void> {
  const repoRoot = await getRepoRoot()
  const { config } = await loadConfig(repoRoot)

  const patches = await listPatchRefs()

  if (patches.length === 0) {
    console.log("No patches found.")
    return
  }

  console.log("Dependency Graph")
  console.log("================")
  console.log("")
  console.log(renderGraph(patches.sort(), config.patches))
}

export async function listDependencies(patch: string): Promise<void> {
  const repoRoot = await getRepoRoot()
  const { config } = await loadConfig(repoRoot)

  const patches = await listPatchRefs()

  if (!patches.includes(patch)) {
    throw new Error(`Patch "${patch}" not found`)
  }

  const metadata = config.patches?.[patch]
  const deps = metadata?.dependencies ?? []
  const dependents = getDependents(patch, config.patches)

  console.log(`Patch: ${patch}`)
  console.log("")

  if (deps.length > 0) {
    console.log("Depends on:")
    for (const dep of deps) {
      console.log(`  - ${dep}`)
    }
  } else {
    console.log("Depends on: (none)")
  }

  console.log("")

  if (dependents.length > 0) {
    console.log("Required by:")
    for (const dep of dependents) {
      console.log(`  - ${dep}`)
    }
  } else {
    console.log("Required by: (none)")
  }
}

export async function setUpstreamPR(patch: string, prUrl: string): Promise<void> {
  const repoRoot = await getRepoRoot()
  const { config, configDir } = await loadConfig(repoRoot)

  const patches = await listPatchRefs()

  if (!patches.includes(patch)) {
    throw new Error(`Patch "${patch}" not found`)
  }

  config.patches = config.patches ?? {}
  config.patches[patch] = config.patches[patch] ?? {}
  config.patches[patch]!.upstreamPR = prUrl

  await saveConfig(configDir, config)
  console.log(`Set upstream PR for "${patch}": ${prUrl}`)
}

export async function setStatus(patch: string, status: "active" | "merged" | "abandoned"): Promise<void> {
  const repoRoot = await getRepoRoot()
  const { config, configDir } = await loadConfig(repoRoot)

  const patches = await listPatchRefs()

  if (!patches.includes(patch)) {
    throw new Error(`Patch "${patch}" not found`)
  }

  config.patches = config.patches ?? {}
  config.patches[patch] = config.patches[patch] ?? {}
  config.patches[patch]!.status = status

  await saveConfig(configDir, config)
  console.log(`Set status for "${patch}": ${status}`)
}
