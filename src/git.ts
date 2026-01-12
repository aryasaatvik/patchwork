import { $ } from "bun"
import { homedir } from "os"
import { z } from "zod"

export async function exec(cmd: string, cwd?: string): Promise<string> {
  const result = await $`sh -c ${cmd}`.cwd(cwd ?? process.cwd()).quiet().nothrow()
  if (result.exitCode !== 0) {
    throw new Error(result.stderr.toString().trim() || `Command failed: ${cmd}`)
  }
  return result.stdout.toString().trim()
}

export async function execRaw(cmd: string, cwd?: string): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const result = await $`sh -c ${cmd}`.cwd(cwd ?? process.cwd()).quiet().nothrow()
  return {
    stdout: result.stdout.toString().trim(),
    stderr: result.stderr.toString().trim(),
    exitCode: result.exitCode,
  }
}

export async function getRepoRoot(): Promise<string> {
  return exec("git rev-parse --show-toplevel")
}

export async function getCurrentBranch(): Promise<string> {
  return exec("git rev-parse --abbrev-ref HEAD")
}

// Zod schemas
const PatchStatusSchema = z.enum(["active", "merged", "abandoned"])

const PatchMetadataSchema = z.object({
  description: z.string().optional(),
  dependencies: z.array(z.string()).optional(),
  upstreamPR: z.string().optional(),
  status: PatchStatusSchema.optional(),
  baseCommit: z.string().optional(),
})

const PatchworkConfigSchema = z.object({
  upstream: z.object({
    remote: z.string(),
    branch: z.string(),
  }),
  buildBranch: z.string(),
  remote: z.string().default("origin"),
  exclude: z.array(z.string()).default([".patchwork"]),
  patches: z.record(z.string(), PatchMetadataSchema).default({}),
})

// Inferred types from Zod schemas
export type PatchStatus = z.infer<typeof PatchStatusSchema>
export type PatchMetadata = z.infer<typeof PatchMetadataSchema>
export type PatchworkConfig = z.infer<typeof PatchworkConfigSchema>

export interface LoadedConfig {
  config: PatchworkConfig
  configDir: string
}

export async function getUpstreamRemote(config: PatchworkConfig): Promise<string> {
  return config.upstream.remote
}

export async function getUpstreamBranch(config: PatchworkConfig): Promise<string> {
  return config.upstream.branch
}

export function getDataDir(): string {
  const xdgDataHome = process.env.XDG_DATA_HOME
  if (xdgDataHome) {
    return `${xdgDataHome}/patchwork`
  }
  return `${homedir()}/.local/share/patchwork`
}

export async function getRepoIdentifier(repoRoot: string): Promise<string> {
  const result = await execRaw("git remote get-url origin", repoRoot)

  if (result.exitCode === 0 && result.stdout) {
    const url = result.stdout
    // SSH: git@github.com:owner/repo.git | HTTPS: https://github.com/owner/repo.git
    const match = url.match(/[:/]([^/:]+)\/([^/]+?)(?:\.git)?$/)
    if (match) {
      return `${match[1]}/${match[2]}`
    }
  }

  const dirName = repoRoot.split("/").pop()
  return `unknown/${dirName ?? "repo"}`
}

export async function loadConfig(repoRoot: string): Promise<LoadedConfig> {
  const localConfigDir = `${repoRoot}/.patchwork`
  const localConfigPath = `${localConfigDir}/config.json`
  const localFile = Bun.file(localConfigPath)

  if (await localFile.exists()) {
    const rawConfig = await localFile.json()
    const config = PatchworkConfigSchema.parse(rawConfig)
    return { config, configDir: localConfigDir }
  }

  const repoId = await getRepoIdentifier(repoRoot)
  const externalConfigDir = `${getDataDir()}/${repoId}`
  const externalConfigPath = `${externalConfigDir}/config.json`
  const externalFile = Bun.file(externalConfigPath)

  if (await externalFile.exists()) {
    const rawConfig = await externalFile.json()
    const config = PatchworkConfigSchema.parse(rawConfig)
    return { config, configDir: externalConfigDir }
  }

  throw new Error("Not a Patchwork repository. Run 'ptchwrk init' first.")
}

export async function saveConfig(configDir: string, config: PatchworkConfig): Promise<void> {
  const configPath = `${configDir}/config.json`
  await Bun.write(configPath, JSON.stringify(config, null, 2) + "\n")
}
