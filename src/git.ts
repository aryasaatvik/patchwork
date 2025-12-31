import { $ } from "bun"
import { homedir } from "os"

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

export async function getUpstreamRemote(config: PatchworkConfig): Promise<string> {
  return config.upstream.remote
}

export async function getUpstreamBranch(config: PatchworkConfig): Promise<string> {
  return config.upstream.branch
}

export interface PatchworkConfig {
  upstream: {
    remote: string
    branch: string
  }
  buildBranch: string
  patchDir: string
}

export interface LoadedConfig {
  config: PatchworkConfig
  configDir: string
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
  const localConfigDir = `${repoRoot}/.ptchwrk`
  const localConfigPath = `${localConfigDir}/config.json`
  const localFile = Bun.file(localConfigPath)
  
  if (await localFile.exists()) {
    const config = await localFile.json() as PatchworkConfig
    return { config, configDir: localConfigDir }
  }
  
  const repoId = await getRepoIdentifier(repoRoot)
  const externalConfigDir = `${getDataDir()}/${repoId}`
  const externalConfigPath = `${externalConfigDir}/config.json`
  const externalFile = Bun.file(externalConfigPath)
  
  if (await externalFile.exists()) {
    const config = await externalFile.json() as PatchworkConfig
    return { config, configDir: externalConfigDir }
  }
  
  throw new Error("Not a Patchwork repository. Run 'ptchwrk init' first.")
}

export async function saveConfig(configDir: string, config: PatchworkConfig): Promise<void> {
  const configPath = `${configDir}/config.json`
  await Bun.write(configPath, JSON.stringify(config, null, 2) + "\n")
}

export function resolvePatchDir(repoRoot: string, configDir: string, patchDir: string): string {
  if (patchDir.startsWith("/")) {
    return patchDir
  }
  if (patchDir.startsWith(".ptchwrk/")) {
    return `${repoRoot}/${patchDir}`
  }
  return `${configDir}/${patchDir}`
}
