# Dry-run config show rewrites invalid configuration files

## Summary

Running `utils config show` with the global `--dry-run` option still rewrites an invalid project config file and creates a backup file. This violates the documented dry-run contract to simulate commands without writing changes.

## Environment

- Date reproduced: 2026-05-24
- Repository branch: `main`
- Package version: `0.0.0-dev`
- Runtime: local TypeScript CLI entrypoint

## Reproduction

From the repository root, run this isolated reproduction using a temporary project and home directory:

```sh
probe=$(mktemp -d)
mkdir -p "$probe/home/.poe-code" "$probe/project/.poe-code"
printf '{ malformed' > "$probe/project/.poe-code/config.json"

(
  cd "$probe/project"
  HOME="$probe/home" npx --prefix /path/to/poe-code tsx \
    --import /path/to/poe-code/scripts/register-template-loader.mjs \
    /path/to/poe-code/src/index.ts --dry-run utils config show
)

find "$probe/project/.poe-code" -maxdepth 1 -type f -print -exec cat {} \;
```

Replace `/path/to/poe-code` with the repository checkout path.

## Observed Behavior

The command exits successfully and prints the config as empty. After running it, the temporary project contains both:

```text
.poe-code/config.json
.poe-code/config.json.invalid-<timestamp>.json
```

The original invalid file content is moved into the timestamped backup, while `.poe-code/config.json` is overwritten with:

```json
{}
```

## Expected Behavior

With `--dry-run`, `utils config show` must not modify files or create backup files. It should either report the invalid config without writing, or simulate the planned recovery while leaving the original file unchanged.

## Impact

- A supposedly non-mutating dry run changes project state.
- Merely inspecting invalid configuration can silently replace the user's source file.
- Users cannot safely use `--dry-run` to diagnose broken configuration before deciding how to recover it.

## Supporting Evidence

The root CLI registers `--dry-run` with the description `Simulate commands without writing changes.` in `src/cli/program.ts`. Invalid JSON reads call recovery logic in `packages/poe-code-config/src/store.ts`, which writes a backup and overwrites the invalid document while reading it.

## Suspected Area

`executeConfigShow` reads config documents without propagating dry-run intent into `readDocument` and `readMergedDocument`, so invalid-config recovery performs disk writes even in dry-run mode.
