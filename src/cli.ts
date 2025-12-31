#!/usr/bin/env bun

import { init } from "./commands/init"
import { exportPatch } from "./commands/export"
import { sync } from "./commands/sync"
import { status } from "./commands/status"
import { drop } from "./commands/drop"

const HELP = `
patchwork - Manage patches on top of upstream repositories

Commands:
  init                     Initialize patchwork in current repo
  export <branch>          Export a branch as a patch
  sync                     Fetch upstream and apply patches
  status                   Show patch status
  drop <patch>             Remove a patch

Options:
  --help, -h               Show this help message
`

async function main() {
  const args = process.argv.slice(2)
  const command = args[0]

  if (!command || command === "--help" || command === "-h") {
    console.log(HELP.trim())
    process.exit(0)
  }

  try {
    switch (command) {
      case "init":
        await init()
        break
      case "export":
        if (!args[1]) {
          console.error("Error: branch name required")
          console.error("Usage: patchwork export <branch>")
          process.exit(1)
        }
        await exportPatch(args[1])
        break
      case "sync":
        await sync()
        break
      case "status":
        await status()
        break
      case "drop":
        if (!args[1]) {
          console.error("Error: patch name required")
          console.error("Usage: patchwork drop <patch>")
          process.exit(1)
        }
        await drop(args[1])
        break
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
