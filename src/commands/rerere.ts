import {
  listStoredRerereRefs,
  deleteRerereRef,
  clearStoredRerereRefs,
} from "../utils/rerere-cache"
import { exec } from "../git"

/**
 * List all stored rerere resolutions
 */
export async function rerereList(): Promise<void> {
  const hashes = await listStoredRerereRefs()

  if (hashes.length === 0) {
    console.log("No stored conflict resolutions.")
    return
  }

  console.log(`Stored conflict resolutions (${hashes.length}):`)
  console.log("")

  for (const hash of hashes) {
    try {
      // Read the blob to show some info
      const content = await exec(`git cat-file blob refs/patchwork/rerere/${hash}`)
      const data = JSON.parse(content) as { preimage: string; postimage: string }

      // Decode preimage to show first line of conflict
      const preimage = Buffer.from(data.preimage, "base64").toString("utf-8")
      const firstLine = preimage.split("\n")[0] || "(empty)"

      console.log(`  ${hash.slice(0, 12)}...  ${firstLine.slice(0, 60)}`)
    } catch {
      console.log(`  ${hash.slice(0, 12)}...  (unable to read)`)
    }
  }
}

/**
 * Delete a specific stored rerere resolution
 */
export async function rerereForget(hash: string): Promise<void> {
  if (!hash) {
    console.error("Error: hash required")
    console.error("Usage: patchwork rerere forget <hash>")
    process.exit(1)
  }

  const hashes = await listStoredRerereRefs()

  // Find matching hash (support partial match)
  const matching = hashes.filter((h) => h.startsWith(hash))

  if (matching.length === 0) {
    console.error(`Error: no resolution found matching '${hash}'`)
    process.exit(1)
  }

  if (matching.length > 1) {
    console.error(`Error: '${hash}' matches multiple resolutions:`)
    for (const h of matching) {
      console.error(`  ${h}`)
    }
    console.error("Please provide a more specific hash.")
    process.exit(1)
  }

  const fullHash = matching[0]!
  await deleteRerereRef(fullHash)
  console.log(`Deleted resolution: ${fullHash}`)
}

/**
 * Clear all stored rerere resolutions
 */
export async function rerereClear(): Promise<void> {
  const hashes = await listStoredRerereRefs()

  if (hashes.length === 0) {
    console.log("No stored resolutions to clear.")
    return
  }

  await clearStoredRerereRefs()
  console.log(`Cleared ${hashes.length} stored resolution(s).`)
}
