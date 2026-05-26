# Dry-run memory init rewrites invalid project configuration

## Summary

Running `memory init` with `--dry-run` rewrites malformed project configuration while only previewing initialization of the memory directory.

## Environment

- Date reproduced: 2026-05-24
- Repository branch: `main`
- Package version: `0.0.0-dev`
- Runtime: local TypeScript CLI entrypoint

## Reproduction

From the repository root, preview memory initialization in a disposable project with malformed configuration:

```sh
probe=$(mktemp -d)
mkdir -p "$probe/home" "$probe/project/.poe-code"
printf '{ invalid json\n' > "$probe/project/.poe-code/config.json"

(
  cd "$probe/project"
  HOME="$probe/home" npx --prefix /path/to/poe-code tsx \
    --import /path/to/poe-code/scripts/register-template-loader.mjs \
    /path/to/poe-code/src/index.ts --dry-run memory init
)

find "$probe/project/.poe-code" -maxdepth 1 -type f -print -exec cat {} \;
```

Replace `/path/to/poe-code` with the repository checkout path.

## Observed Behavior

- The command prints `Would initialize memory at .../.poe-code/memory`.
- `.poe-code/config.json` is overwritten with `{}`.
- `.poe-code/config.json.invalid-<timestamp>.json` is created containing the malformed original.

## Expected Behavior

With `--dry-run`, memory initialization must not modify project configuration or create recovery files while calculating the intended memory directory.

## Impact

- A preview intended to be non-mutating silently dirties the project.
- Users can lose the malformed file at its original path merely by inspecting initialization behavior.
- Automated preview workflows cannot rely on the advertised dry-run contract.

## Supporting Evidence

The root CLI advertises `--dry-run` as `Simulate commands without writing changes.` in `src/cli/program.ts`. `src/cli/commands/memory.ts` resolves the memory root before its dry-run return, and `packages/memory/src/resolve-root.ts` reaches invalid-document recovery in `packages/poe-code-config/src/store.ts`, which writes replacement and backup files.

## Suspected Area

Memory root resolution during previews needs a non-mutating configuration read path.
