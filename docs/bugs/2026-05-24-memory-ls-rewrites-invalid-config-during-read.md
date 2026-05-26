# Memory ls rewrites invalid configuration during a read-only command

## Summary

Running `memory ls` against a project with malformed `.poe-code/config.json` overwrites the configuration file and creates an invalid-content backup, even though `memory ls` is a read-only listing command.

## Environment

- Date reproduced: 2026-05-24
- Repository branch: `main`
- Package version: `0.0.0-dev`
- Runtime: local TypeScript CLI entrypoint

## Reproduction

From the repository root, run this isolated temporary-project reproduction:

```sh
probe=$(mktemp -d)
mkdir -p "$probe/project/.poe-code/memory" "$probe/home"
printf '{ malformed' > "$probe/project/.poe-code/config.json"
printf '# Memory index\n' > "$probe/project/.poe-code/memory/INDEX.md"
printf '' > "$probe/project/.poe-code/memory/LOG.md"

(
  cd "$probe/project"
  HOME="$probe/home" npx --prefix /path/to/poe-code tsx \
    --import /path/to/poe-code/scripts/register-template-loader.mjs \
    /path/to/poe-code/src/index.ts memory ls
)

find "$probe/project/.poe-code" -maxdepth 1 -type f -print -exec cat {} \;
```

Replace `/path/to/poe-code` with the repository checkout path.

## Observed Behavior

The command prints `No memory pages yet.` and exits successfully. Despite only listing memory pages, it changes configuration state:

```text
.poe-code/config.json
.poe-code/config.json.invalid-<timestamp>.json
```

The original malformed content is preserved in the timestamped backup, and `.poe-code/config.json` is overwritten with `{}`.

## Expected Behavior

`memory ls` must not write files while listing memory pages. If a malformed configuration prevents resolving the memory root, it should report the error or proceed with an explicitly non-mutating fallback without replacing project configuration.

## Impact

- Inspecting memory contents changes unrelated project configuration state.
- A read-only command silently performs recovery and hides malformed input from subsequent diagnosis.
- Users can lose the exact configuration file they intended to inspect before making recovery choices.

## Supporting Evidence

`memory ls` resolves the memory root through `resolveConfiguredMemoryRoot` in `packages/memory/src/resolve-root.ts`. That reads configuration through `configuredMemoryRoot` and `readMergedDocument`, whose invalid-JSON recovery logic in `packages/poe-code-config/src/store.ts` writes a backup and replaces the file during the read.

## Suspected Area

Configuration parsing performs mutating recovery as part of generic reads. Read-only consumers such as memory commands need a non-mutating parse/error path instead of silently rewriting invalid configuration.
