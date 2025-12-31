import { $ } from "bun"

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

export async function loadConfig(repoRoot: string): Promise<PatchworkConfig> {
  const configPath = `${repoRoot}/.ptchwrk/config.json`
  const file = Bun.file(configPath)
  if (!(await file.exists())) {
    throw new Error("Not a Patchwork repository. Run 'ptchwrk init' first.")
  }
  return file.json()
}

export async function saveConfig(repoRoot: string, config: PatchworkConfig): Promise<void> {
  const configPath = `${repoRoot}/.ptchwrk/config.json`
  await Bun.write(configPath, JSON.stringify(config, null, 2) + "\n")
}
