import type { PatchMetadata } from "../git"

export interface DependencyGraph {
  nodes: Set<string>
  edges: Map<string, string[]> // patch -> dependencies
}

export class CyclicDependencyError extends Error {
  constructor(public cycle: string[]) {
    super(`Cyclic dependency detected: ${cycle.join(" -> ")}`)
    this.name = "CyclicDependencyError"
  }
}

export class MissingDependencyError extends Error {
  constructor(public patch: string, public missingDep: string) {
    super(`Patch "${patch}" depends on "${missingDep}" which does not exist`)
    this.name = "MissingDependencyError"
  }
}

/**
 * Build a dependency graph from patch manifest
 */
export function buildDependencyGraph(
  patchFiles: string[],
  manifest: Record<string, PatchMetadata> | undefined
): DependencyGraph {
  const nodes = new Set(patchFiles)
  const edges = new Map<string, string[]>()

  for (const patch of patchFiles) {
    const metadata = manifest?.[patch]
    const deps = metadata?.dependencies ?? []
    edges.set(patch, deps)
  }

  return { nodes, edges }
}

/**
 * Topological sort using Kahn's algorithm
 * Returns patches in order that respects dependencies
 */
export function topologicalSort(graph: DependencyGraph): string[] {
  const { nodes, edges } = graph

  // Validate all dependencies exist
  for (const [patch, deps] of edges) {
    for (const dep of deps) {
      if (!nodes.has(dep)) {
        throw new MissingDependencyError(patch, dep)
      }
    }
  }

  // Calculate in-degree (number of patches that depend on each patch)
  const inDegree = new Map<string, number>()
  const reverseDeps = new Map<string, string[]>() // dependency -> patches that need it

  for (const node of nodes) {
    inDegree.set(node, 0)
    reverseDeps.set(node, [])
  }

  for (const [patch, deps] of edges) {
    for (const dep of deps) {
      reverseDeps.get(dep)!.push(patch)
    }
  }

  for (const [patch, deps] of edges) {
    inDegree.set(patch, deps.length)
  }

  // Start with patches that have no dependencies
  const queue: string[] = []
  for (const [node, degree] of inDegree) {
    if (degree === 0) {
      queue.push(node)
    }
  }

  // Sort queue alphabetically for consistent ordering among patches with same dependencies
  queue.sort()

  const result: string[] = []
  const visited = new Set<string>()

  while (queue.length > 0) {
    const current = queue.shift()!
    result.push(current)
    visited.add(current)

    // Find patches that depend on current, reduce their in-degree
    const dependents = reverseDeps.get(current) ?? []
    const newReady: string[] = []

    for (const dependent of dependents) {
      const newDegree = inDegree.get(dependent)! - 1
      inDegree.set(dependent, newDegree)
      if (newDegree === 0) {
        newReady.push(dependent)
      }
    }

    // Sort new patches alphabetically and add to queue
    newReady.sort()
    queue.push(...newReady)
  }

  // Check for cycles
  if (result.length !== nodes.size) {
    const remaining = [...nodes].filter((n) => !visited.has(n))
    const cycle = detectCycle(remaining, edges)
    throw new CyclicDependencyError(cycle)
  }

  return result
}

/**
 * Detect a cycle in the remaining nodes (for error reporting)
 */
function detectCycle(remaining: string[], edges: Map<string, string[]>): string[] {
  const visited = new Set<string>()
  const path: string[] = []

  function dfs(node: string): string[] | null {
    if (path.includes(node)) {
      const cycleStart = path.indexOf(node)
      return [...path.slice(cycleStart), node]
    }
    if (visited.has(node)) return null

    path.push(node)
    const deps = edges.get(node) ?? []
    for (const dep of deps) {
      if (remaining.includes(dep)) {
        const cycle = dfs(dep)
        if (cycle) return cycle
      }
    }
    path.pop()
    visited.add(node)
    return null
  }

  for (const node of remaining) {
    const cycle = dfs(node)
    if (cycle) return cycle
  }

  return remaining // Fallback: just return remaining nodes
}

/**
 * Get patches that depend on a given patch (direct dependents)
 */
export function getDependents(
  patch: string,
  manifest: Record<string, PatchMetadata> | undefined
): string[] {
  if (!manifest) return []

  const dependents: string[] = []
  for (const [name, metadata] of Object.entries(manifest)) {
    if (metadata.dependencies?.includes(patch)) {
      dependents.push(name)
    }
  }
  return dependents.sort()
}

/**
 * Get all transitive dependencies of a patch
 */
export function getTransitiveDependencies(
  patch: string,
  manifest: Record<string, PatchMetadata> | undefined,
  visited = new Set<string>()
): string[] {
  if (!manifest || visited.has(patch)) return []

  visited.add(patch)
  const metadata = manifest[patch]
  const directDeps = metadata?.dependencies ?? []
  const allDeps = new Set(directDeps)

  for (const dep of directDeps) {
    const transitive = getTransitiveDependencies(dep, manifest, visited)
    for (const t of transitive) {
      allDeps.add(t)
    }
  }

  return [...allDeps].sort()
}

/**
 * Render dependency graph as ASCII art
 */
export function renderGraph(
  patchFiles: string[],
  manifest: Record<string, PatchMetadata> | undefined
): string {
  const lines: string[] = []
  const sorted = topologicalSort(buildDependencyGraph(patchFiles, manifest))

  for (const patch of sorted) {
    const metadata = manifest?.[patch]
    const deps = metadata?.dependencies ?? []
    const status = metadata?.status ?? "active"
    const statusIcon = status === "merged" ? "✓" : status === "abandoned" ? "✗" : "○"

    if (deps.length === 0) {
      lines.push(`${statusIcon} ${patch}`)
    } else {
      lines.push(`${statusIcon} ${patch}`)
      for (let i = 0; i < deps.length; i++) {
        const isLast = i === deps.length - 1
        const prefix = isLast ? "  └── " : "  ├── "
        lines.push(`${prefix}depends on: ${deps[i]}`)
      }
    }
  }

  return lines.join("\n")
}
