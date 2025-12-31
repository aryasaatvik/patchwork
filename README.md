# ptchwrk

Manage patches on top of upstream repositories.

## Why?

When you maintain local patches on top of an upstream repo (like a fork with custom features), rebasing gets messy. `ptchwrk` exports your changes as patch files that can be cleanly reapplied whenever upstream updates.

## Install

```bash
# npm
npm install -g ptchwrk

# or run directly
bunx ptchwrk
```

## Usage

```bash
# Initialize in your repo
ptchwrk init

# Export a branch as a patch
ptchwrk export my-feature-branch

# Fetch upstream and apply all patches
ptchwrk sync

# Check status
ptchwrk status

# Remove a merged patch
ptchwrk drop 001-my-feature-branch.patch
```

## How it works

1. **init** - Creates `.patchwork/` directory with config pointing to your upstream branch
2. **export** - Generates a `.patch` file from commits unique to a branch (vs upstream)
3. **sync** - Fetches upstream, creates a fresh build branch, applies all patches in order
4. **status** - Shows current patches and their sizes
5. **drop** - Removes a patch file (use after upstream merges your PR)

## Config

`.patchwork/config.json`:
```json
{
  "upstream": {
    "remote": "origin",
    "branch": "main"
  },
  "buildBranch": "patchwork-build",
  "patchDir": ".patchwork/patches"
}
```

## License

MIT
