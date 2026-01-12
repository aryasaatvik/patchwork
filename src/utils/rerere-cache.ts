import { exec, execRaw, getRepoRoot } from "../git"
import { existsSync } from "fs"
import { readdir, readFile, writeFile, mkdir, rm, cp } from "fs/promises"
import { join } from "path"
import { tmpdir } from "os"

const RERERE_REFS_PREFIX = "refs/patchwork/rerere"

/**
 * Get the path to .git/rr-cache
 */
async function getRerereCachePath(): Promise<string> {
  const repoRoot = await getRepoRoot()
  return join(repoRoot, ".git", "rr-cache")
}

/**
 * Save user's existing rr-cache to a temp location
 * Returns the temp path where cache was saved, or null if no cache existed
 */
export async function saveUserRerereCache(): Promise<string | null> {
  const cachePath = await getRerereCachePath()

  if (!existsSync(cachePath)) {
    return null
  }

  const tempPath = join(tmpdir(), `patchwork-user-rerere-${Date.now()}`)
  await cp(cachePath, tempPath, { recursive: true })
  return tempPath
}

/**
 * Restore user's original rr-cache from temp location
 */
export async function restoreUserRerereCache(tempPath: string | null): Promise<void> {
  const cachePath = await getRerereCachePath()

  // Clear current cache
  if (existsSync(cachePath)) {
    await rm(cachePath, { recursive: true, force: true })
  }

  // Restore from temp if it existed
  if (tempPath && existsSync(tempPath)) {
    await cp(tempPath, cachePath, { recursive: true })
    await rm(tempPath, { recursive: true, force: true })
  }
}

/**
 * Clear the local rr-cache
 */
export async function clearRerereCache(): Promise<void> {
  const cachePath = await getRerereCachePath()
  if (existsSync(cachePath)) {
    await rm(cachePath, { recursive: true, force: true })
  }
}

/**
 * Enable rerere for the current repo
 */
export async function enableRerere(): Promise<void> {
  await exec("git config rerere.enabled true")
}

/**
 * List local rr-cache entries (returns hashes)
 */
export async function listLocalRerereEntries(): Promise<string[]> {
  const cachePath = await getRerereCachePath()

  if (!existsSync(cachePath)) {
    return []
  }

  const entries = await readdir(cachePath, { withFileTypes: true })
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
}

/**
 * List stored rerere refs (returns hashes)
 */
export async function listStoredRerereRefs(): Promise<string[]> {
  const result = await execRaw(`git for-each-ref ${RERERE_REFS_PREFIX}/ --format='%(refname:short)'`)

  if (result.exitCode !== 0 || !result.stdout.trim()) {
    return []
  }

  return result.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((ref) => {
      // Remove prefix to get just the hash
      const prefix = "patchwork/rerere/"
      return ref.startsWith(prefix) ? ref.slice(prefix.length) : ref
    })
}

/**
 * Store a single rerere entry as a git ref
 */
export async function storeRerereRef(hash: string): Promise<void> {
  const cachePath = await getRerereCachePath()
  const entryPath = join(cachePath, hash)

  if (!existsSync(entryPath)) {
    throw new Error(`Rerere entry not found: ${hash}`)
  }

  // Read preimage and postimage
  const preimage = await readFile(join(entryPath, "preimage"), "utf-8").catch(() => null)
  const postimage = await readFile(join(entryPath, "postimage"), "utf-8").catch(() => null)

  if (!preimage || !postimage) {
    // Entry not fully resolved yet, skip
    return
  }

  // Create JSON blob with base64-encoded content
  const content = JSON.stringify({
    preimage: Buffer.from(preimage).toString("base64"),
    postimage: Buffer.from(postimage).toString("base64"),
  })

  // Write content as a blob
  const proc = Bun.spawn(["git", "hash-object", "-w", "--stdin"], {
    stdin: new TextEncoder().encode(content),
    stdout: "pipe",
    stderr: "pipe",
  })

  const blobHash = (await new Response(proc.stdout).text()).trim()
  const exitCode = await proc.exited

  if (exitCode !== 0 || !blobHash) {
    throw new Error(`Failed to create blob for rerere entry: ${hash}`)
  }

  // Create ref pointing to blob
  await exec(`git update-ref ${RERERE_REFS_PREFIX}/${hash} ${blobHash}`)
}

/**
 * Restore all rerere refs to .git/rr-cache
 */
export async function restoreRerereFromRefs(): Promise<void> {
  const storedHashes = await listStoredRerereRefs()

  if (storedHashes.length === 0) {
    return
  }

  const cachePath = await getRerereCachePath()
  await mkdir(cachePath, { recursive: true })

  for (const hash of storedHashes) {
    try {
      // Read the blob content
      const content = await exec(`git cat-file blob ${RERERE_REFS_PREFIX}/${hash}`)
      const data = JSON.parse(content) as { preimage: string; postimage: string }

      // Create entry directory
      const entryPath = join(cachePath, hash)
      await mkdir(entryPath, { recursive: true })

      // Write preimage and postimage
      await writeFile(
        join(entryPath, "preimage"),
        Buffer.from(data.preimage, "base64").toString("utf-8")
      )
      await writeFile(
        join(entryPath, "postimage"),
        Buffer.from(data.postimage, "base64").toString("utf-8")
      )
    } catch (err) {
      // Skip invalid entries
      console.error(`Warning: Failed to restore rerere entry ${hash}:`, err)
    }
  }
}

/**
 * Capture new rerere entries that weren't in the previous set
 */
export async function captureNewRerereEntries(previousHashes: string[]): Promise<string[]> {
  const currentHashes = await listLocalRerereEntries()
  const previousSet = new Set(previousHashes)

  const newHashes: string[] = []

  for (const hash of currentHashes) {
    if (!previousSet.has(hash)) {
      // Check if this entry has a postimage (fully resolved)
      const cachePath = await getRerereCachePath()
      const postImagePath = join(cachePath, hash, "postimage")

      if (existsSync(postImagePath)) {
        newHashes.push(hash)
      }
    }
  }

  return newHashes
}

/**
 * Delete a stored rerere ref
 */
export async function deleteRerereRef(hash: string): Promise<void> {
  await exec(`git update-ref -d ${RERERE_REFS_PREFIX}/${hash}`)
}

/**
 * Delete all stored rerere refs
 */
export async function clearStoredRerereRefs(): Promise<void> {
  const hashes = await listStoredRerereRefs()
  for (const hash of hashes) {
    await deleteRerereRef(hash)
  }
}

/**
 * Push rerere refs to remote
 */
export async function pushRerereRefs(remote: string = "origin"): Promise<void> {
  const hashes = await listStoredRerereRefs()
  if (hashes.length === 0) {
    return
  }
  await exec(`git push --force ${remote} '${RERERE_REFS_PREFIX}/*:${RERERE_REFS_PREFIX}/*'`)
}

/**
 * Fetch rerere refs from remote
 */
export async function fetchRerereRefs(remote: string = "origin"): Promise<void> {
  // Use nothrow since refs might not exist on remote
  await execRaw(`git fetch ${remote} '${RERERE_REFS_PREFIX}/*:${RERERE_REFS_PREFIX}/*'`)
}
