#!/usr/bin/env bun

import { init } from "./commands/init"
import { exportPatch, type ExportOptions } from "./commands/export"
import { sync } from "./commands/sync"
import { status } from "./commands/status"
import { drop } from "./commands/drop"
import {
  addDependency,
  removeDependency,
  showGraph,
  listDependencies,
  setUpstreamPR,
  setStatus,
} from "./commands/deps"
import { checkMerged } from "./commands/check-merged"
import { resolve } from "./commands/resolve"
import { pushPatchRefs, fetchPatchRefs } from "./utils/patch-refs"
import { getRepoRoot, loadConfig } from "./git"

const HELP = `
Patchwork (ptchwrk) - Manage patches on top of upstream repositories

Commands:
  init [--tracked]         Initialize Patchwork (default: ~/.local/share/patchwork/)
  export <branch>          Export a branch as a patch
  sync                     Fetch upstream and apply patches
  status                   Show patch status
  drop <patch>...          Remove patch(es)
  push [remote]            Push patch refs to remote (default: origin)
  fetch [remote]           Fetch patch refs from remote (default: origin)
  deps                     Manage patch dependencies (subcommands: add, remove, graph)
  check-merged [--update]  Check if upstream PRs have merged
  resolve [--patch]        Resolve merge conflicts

Export Options:
  --depends-on <patch>     Add dependency (can be used multiple times)
  --pr <url>               Link to upstream PR
  --description <text>     Custom description

Options:
  --help, -h               Show this help message
  --tracked, -t            Store config in repo (.patchwork/) instead of externally
`

function parseArgs(args: string[]): { positional: string[]; flags: Record<string, string[]> } {
  const positional: string[] = []
  const flags: Record<string, string[]> = {}

  let i = 0
  while (i < args.length) {
    const arg = args[i]!
    if (arg.startsWith("--")) {
      const key = arg.slice(2)
      const value = args[i + 1]
      if (value && !value.startsWith("--")) {
        flags[key] = flags[key] ?? []
        flags[key]!.push(value)
        i += 2
      } else {
        flags[key] = flags[key] ?? []
        flags[key]!.push("true")
        i += 1
      }
    } else if (arg.startsWith("-")) {
      const key = arg.slice(1)
      flags[key] = flags[key] ?? []
      flags[key]!.push("true")
      i += 1
    } else {
      positional.push(arg)
      i += 1
    }
  }

  return { positional, flags }
}

async function main() {
  const args = process.argv.slice(2)
  const command = args[0]

  if (!command || command === "--help" || command === "-h") {
    console.log(HELP.trim())
    process.exit(0)
  }

  try {
    switch (command) {
      case "init": {
        const tracked = args.includes("--tracked") || args.includes("-t")
        await init(tracked)
        break
      }
      case "export": {
        const { positional, flags } = parseArgs(args.slice(1))
        const branch = positional[0]
        if (!branch) {
          console.error("Error: branch name required")
          console.error("Usage: ptchwrk export <branch> [--depends-on <patch>] [--pr <url>]")
          process.exit(1)
        }
        const options: ExportOptions = {
          dependsOn: flags["depends-on"],
          upstreamPR: flags["pr"]?.[0],
          description: flags["description"]?.[0],
        }
        await exportPatch(branch, options)
        break
      }
      case "sync":
        await sync()
        break
      case "status":
        await status()
        break
      case "push": {
        const repoRoot = await getRepoRoot()
        const { config } = await loadConfig(repoRoot)
        const remote = args[1] ?? config.remote
        console.log(`Pushing patch refs to ${remote}...`)
        await pushPatchRefs(remote)
        console.log("Done.")
        break
      }
      case "fetch": {
        const repoRoot = await getRepoRoot()
        const { config } = await loadConfig(repoRoot)
        const remote = args[1] ?? config.remote
        console.log(`Fetching patch refs from ${remote}...`)
        await fetchPatchRefs(remote)
        console.log("Done.")
        break
      }
      case "check-merged": {
        const autoUpdate = args.includes("--update") || args.includes("-u")
        await checkMerged({ autoUpdate })
        break
      }
      case "resolve": {
        const { positional, flags } = parseArgs(args.slice(1))
        await resolve({
          patch: flags["patch"]?.[0] ?? positional[0],
          dryRun: !!flags["dry-run"],
          auto: !!flags["auto"],
        })
        break
      }
      case "drop": {
        const patchArgs = args.slice(1)
        if (patchArgs.length === 0) {
          console.error("Error: at least one patch name required")
          console.error("Usage: ptchwrk drop <patch>...")
          process.exit(1)
        }
        await drop(patchArgs)
        break
      }
      case "deps": {
        const subcommand = args[1]
        switch (subcommand) {
          case "add": {
            const patch = args[2]
            const dep = args[3]
            if (!patch || !dep) {
              console.error("Usage: ptchwrk deps add <patch> <depends-on>")
              process.exit(1)
            }
            await addDependency(patch, dep)
            break
          }
          case "remove": {
            const patch = args[2]
            const dep = args[3]
            if (!patch || !dep) {
              console.error("Usage: ptchwrk deps remove <patch> <dependency>")
              process.exit(1)
            }
            await removeDependency(patch, dep)
            break
          }
          case "graph":
            await showGraph()
            break
          case "list": {
            const patch = args[2]
            if (!patch) {
              console.error("Usage: ptchwrk deps list <patch>")
              process.exit(1)
            }
            await listDependencies(patch)
            break
          }
          case "set-pr": {
            const patch = args[2]
            const prUrl = args[3]
            if (!patch || !prUrl) {
              console.error("Usage: ptchwrk deps set-pr <patch> <pr-url>")
              process.exit(1)
            }
            await setUpstreamPR(patch, prUrl)
            break
          }
          case "set-status": {
            const patch = args[2]
            const newStatus = args[3] as "active" | "merged" | "abandoned"
            if (!patch || !newStatus || !["active", "merged", "abandoned"].includes(newStatus)) {
              console.error("Usage: ptchwrk deps set-status <patch> <active|merged|abandoned>")
              process.exit(1)
            }
            await setStatus(patch, newStatus)
            break
          }
          default:
            console.error("Deps subcommands: add, remove, graph, list, set-pr, set-status")
            console.error("")
            console.error("  ptchwrk deps add <patch> <depends-on>")
            console.error("  ptchwrk deps remove <patch> <dependency>")
            console.error("  ptchwrk deps graph")
            console.error("  ptchwrk deps list <patch>")
            console.error("  ptchwrk deps set-pr <patch> <pr-url>")
            console.error("  ptchwrk deps set-status <patch> <active|merged|abandoned>")
            process.exit(1)
        }
        break
      }
      default:
        console.error(`Unknown command: ${command}`)
        console.log(HELP.trim())
        process.exit(1)
    }
  } catch (error) {
    console.error(`Error: ${error instanceof Error ? error.message : error}`)
    process.exit(1)
  }
}

main()
