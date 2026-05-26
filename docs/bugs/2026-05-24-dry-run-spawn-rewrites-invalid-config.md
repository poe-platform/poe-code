# Dry-run spawn rewrites invalid configuration

## Summary

Running `spawn` with `--dry-run` rewrites a malformed global configuration file while resolving the configured model for the preview. The command does not launch an agent, but it still replaces the invalid config with `{}` and creates a backup file.

## Environment

- Date reproduced: 2026-05-24
- Repository branch: `main`
- Package version: `0.0.0-dev`
- Runtime: local TypeScript CLI entrypoint

## Reproduction

From the repository root, create a disposable home containing malformed Poe configuration and preview a Codex spawn:

```sh
probe=$(mktemp -d)
mkdir -p "$probe/home/.poe-code" "$probe/project"
printf '{ invalid json\n' > "$probe/home/.poe-code/config.json"

(
  cd "$probe/project"
  HOME="$probe/home" npx --prefix /path/to/poe-code tsx \
    --import /path/to/poe-code/scripts/register-template-loader.mjs \
    /path/to/poe-code/src/index.ts --dry-run spawn codex 'hello'
)

find "$probe/home/.poe-code" -maxdepth 1 -type f -print -exec cat {} \;
```

Replace `/path/to/poe-code` with the repository checkout path.

## Observed Behavior

The command prints `Dry run: would spawn Codex.` and does not invoke the agent, but its model/config lookup changes the isolated home:

- `.poe-code/config.json` changes from malformed input to `{}`.
- `.poe-code/config.json.invalid-<timestamp>.json` is created containing the original malformed input.

## Expected Behavior

With `--dry-run`, previewing a spawn must not repair, replace, or back up configuration files. It should obtain display data without writes or fail with a read-only configuration error.

## Impact

- Previewing an agent invocation unexpectedly changes user configuration.
- A malformed file is replaced even though the requested agent never runs.
- CI or tooling that uses spawn previews can dirty persistent home state.

## Supporting Evidence

The root CLI describes `--dry-run` as `Simulate commands without writing changes.` in `src/cli/program.ts`. `src/cli/commands/spawn.ts` calls `resolveConfiguredModel` before invoking the dry-run branch of `spawnCore`, and configuration recovery in `packages/poe-code-config/src/store.ts` persists a replacement plus invalid-document backup.

## Suspected Area

Dry-run model/config reads need a non-mutating invalid-document policy, or configuration recovery should only run for explicit repair or write actions.
