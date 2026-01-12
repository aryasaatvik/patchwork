import { exec, execRaw } from "../git"

const REFS_PREFIX = "refs/patchwork/patches"

/**
 * Store a patch in git refs
 * Creates a blob with the patch content and points a ref to it
 */
export async function storePatchRef(name: string, content: string): Promise<void> {
  // Write the patch content as a blob
  const proc = Bun.spawn(["git", "hash-object", "-w", "--stdin"], {
    stdin: new TextEncoder().encode(content),
    stdout: "pipe",
    stderr: "pipe",
  })

  const hash = (await new Response(proc.stdout).text()).trim()
  const exitCode = await proc.exited

  if (exitCode !== 0 || !hash) {
    throw new Error(`Failed to create blob for patch: ${name}`)
  }

  // Create the ref pointing to the blob
  await exec(`git update-ref ${REFS_PREFIX}/${name} ${hash}`)
}

/**
 * Read a patch from git refs
 */
export async function readPatchRef(name: string): Promise<string> {
  return exec(`git cat-file blob ${REFS_PREFIX}/${name}`)
}

/**
 * List all patch refs, returns patch names (without the refs/patchwork/patches/ prefix)
 */
export async function listPatchRefs(): Promise<string[]> {
  const result = await execRaw(`git for-each-ref ${REFS_PREFIX}/ --format='%(refname:short)'`)

  if (result.exitCode !== 0 || !result.stdout.trim()) {
    return []
  }

  return result.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((ref) => {
      // Remove the prefix to get just the patch name
      const prefix = "patchwork/patches/"
      return ref.startsWith(prefix) ? ref.slice(prefix.length) : ref
    })
}

/**
 * Delete a patch ref
 */
export async function deletePatchRef(name: string): Promise<void> {
  await exec(`git update-ref -d ${REFS_PREFIX}/${name}`)
}

/**
 * Check if a patch ref exists
 */
export async function patchRefExists(name: string): Promise<boolean> {
  const result = await execRaw(`git show-ref --verify ${REFS_PREFIX}/${name}`)
  return result.exitCode === 0
}

/**
 * Push patchwork refs to remote
 * Uses --force because blob refs can't be incrementally updated
 */
export async function pushPatchRefs(remote: string = "origin"): Promise<void> {
  await exec(`git push --force ${remote} 'refs/patchwork/*:refs/patchwork/*'`)
}

/**
 * Fetch patchwork refs from remote
 */
export async function fetchPatchRefs(remote: string = "origin"): Promise<void> {
  await exec(`git fetch ${remote} 'refs/patchwork/*:refs/patchwork/*'`)
}

/**
 * Get the next patch number based on existing patches
 */
export async function getNextPatchNumber(): Promise<number> {
  const patches = await listPatchRefs()
  const numbers = patches
    .filter((name) => name.endsWith(".patch"))
    .map((name) => parseInt(name.split("-")[0] ?? "0", 10))
    .filter((n) => !isNaN(n))

  return numbers.length > 0 ? Math.max(...numbers) + 1 : 1
}
