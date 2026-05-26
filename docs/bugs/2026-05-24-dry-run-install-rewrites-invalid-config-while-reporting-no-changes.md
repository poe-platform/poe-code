# Dry-run install rewrites invalid config while reporting no changes

## Summary

Running `install` with `--dry-run --yes` and no explicit agent rewrites malformed global configuration while selecting the default agent, then reports `# no filesystem changes`.

## Environment

- Date reproduced: 2026-05-24
- Repository branch: `main`
- Package version: `0.0.0-dev`
- Runtime: local TypeScript CLI entrypoint

## Reproduction

From the repository root, create a disposable home with malformed configuration and preview installation:

```sh
probe=$(mktemp -d)
mkdir -p "$probe/home/.poe-code" "$probe/project"
printf '{ invalid json\n' > "$probe/home/.poe-code/config.json"

(
  cd "$probe/project"
  HOME="$probe/home" npx --prefix /path/to/poe-code tsx \
    --import /path/to/poe-code/scripts/register-template-loader.mjs \
    /path/to/poe-code/src/index.ts --dry-run --yes install
)

find "$probe/home/.poe-code" -maxdepth 1 -type f -print -exec cat {} \;
```

Replace `/path/to/poe-code` with the repository checkout path.

## Observed Behavior

- The command previews `Claude Code install (dry run)` and prints `# no filesystem changes`.
- `.poe-code/config.json` is overwritten with `{}`.
- `.poe-code/config.json.invalid-<timestamp>.json` is created containing the malformed original.

## Expected Behavior

With `--dry-run`, installation previews must not persist repairs to global configuration while resolving a default agent or reporting proposed installation work.

## Impact

- A binary installation preview silently modifies global configuration.
- The output directly contradicts actual filesystem changes.
- Automation that checks installation behavior without changes can unexpectedly alter user state.

## Supporting Evidence

The root CLI advertises `--dry-run` as `Simulate commands without writing changes.` in `src/cli/program.ts`. `src/cli/commands/install.ts` delegates omitted-agent selection to `resolveServiceArgument`, which calls `resolveDefaultAgent`; invalid-document recovery reached through `readMergedDocument` in `packages/poe-code-config/src/store.ts` writes replacement and backup files.

## Suspected Area

Install previews need side-effect-free default-agent resolution, and dry-run reporting must account for configuration recovery paths.
