# An empty memory directory is reported as initialized

## Summary

Memory initialization requires creating `INDEX.md`, `LOG.md`, and `pages/`, but `statusOf()` marks memory as initialized whenever the memory root directory merely exists. As a result, `poe-code memory ls`, `memory search`, and `memory status` all succeed against an empty `.poe-code/memory/` directory instead of instructing the user to run `memory init`.

## Reproduction

From the repository root, create only an empty memory directory in a disposable project and invoke the read/status commands:

```sh
repo=$PWD
probe=$(mktemp -d)
project="$probe/project"
home="$probe/home"
mkdir -p "$project/.poe-code/memory" "$home"

(
  cd "$project" || exit 1

  HOME="$home" \
    "$repo/node_modules/.bin/tsx" \
    --import "$repo/scripts/register-template-loader.mjs" \
    "$repo/src/index.ts" memory ls

  HOME="$home" \
    "$repo/node_modules/.bin/tsx" \
    --import "$repo/scripts/register-template-loader.mjs" \
    "$repo/src/index.ts" memory search needle

  HOME="$home" \
    "$repo/node_modules/.bin/tsx" \
    --import "$repo/scripts/register-template-loader.mjs" \
    "$repo/src/index.ts" memory status --no-tokens
)

nl -ba packages/memory/src/status.ts | sed -n '12,41p'
nl -ba src/cli/commands/memory.ts | sed -n '41,47p;92,110p;150,171p;174,208p'
```

## Observed Behavior

All commands exit successfully even though no memory scaffold has been initialized:

```text
No memory pages yet.
No matches.
Pages: 0
Bytes: 0
```

`statusOf()` sets `initialized: false` only when the root directory is missing. Once an empty directory exists, it returns `initialized: true` without checking for `INDEX.md`, `LOG.md`, or `pages/`, so the CLI's `assertInitialized()` guard no longer protects these commands.

## Expected Behavior

Memory should be considered initialized only when its required scaffold exists, or read/status commands should otherwise detect and report incomplete initialization. For an empty `.poe-code/memory/` directory, the CLI should reject the operation with its existing instruction to run `poe-code memory init`.

## Impact

Interrupted setup, manually created directories, or partial cleanup can produce a state that is reported as valid but lacks required memory files. Users and agents receive misleading empty results rather than a repairable initialization error, and later operations may fail inconsistently when they assume `INDEX.md` or `LOG.md` exists.
