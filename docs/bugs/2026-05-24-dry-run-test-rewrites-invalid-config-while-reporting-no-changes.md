# Dry-run test rewrites invalid config while reporting no changes

## Summary

Running `test` with `--dry-run --yes` and no explicit agent rewrites malformed global configuration while resolving the service to health-check, then reports `# no filesystem changes`.

## Environment

- Date reproduced: 2026-05-24
- Repository branch: `main`
- Package version: `0.0.0-dev`
- Runtime: local TypeScript CLI entrypoint

## Reproduction

From the repository root, create a disposable home with malformed configuration and preview the default test command:

```sh
probe=$(mktemp -d)
mkdir -p "$probe/home/.poe-code" "$probe/project"
printf '{ invalid json\n' > "$probe/home/.poe-code/config.json"

(
  cd "$probe/project"
  HOME="$probe/home" npx --prefix /path/to/poe-code tsx \
    --import /path/to/poe-code/scripts/register-template-loader.mjs \
    /path/to/poe-code/src/index.ts --dry-run --yes test
)

find "$probe/home/.poe-code" -maxdepth 1 -type f -print -exec cat {} \;
```

Replace `/path/to/poe-code` with the repository checkout path.

## Observed Behavior

- The command selects `claude-code`, reports the dry-run health-check command, and prints `# no filesystem changes`.
- `.poe-code/config.json` is overwritten with `{}`.
- `.poe-code/config.json.invalid-<timestamp>.json` is created containing the malformed original.

## Expected Behavior

With `--dry-run`, default service resolution and health-check preview must not persist repairs to global configuration or otherwise mutate user state.

## Impact

- An apparently safe agent health-check preview silently repairs global configuration.
- The command output explicitly contradicts the filesystem mutation.
- CI or diagnostics that use dry-run to evaluate a configured health check can unexpectedly change user configuration.

## Supporting Evidence

The root CLI advertises `--dry-run` as `Simulate commands without writing changes.` in `src/cli/program.ts`. `src/cli/commands/test.ts` resolves the service argument before executing the dry-run health check; default-agent resolution reaches `readMergedDocument` through shared command configuration, and invalid-document recovery in `packages/poe-code-config/src/store.ts` writes replacement and backup files.

## Suspected Area

Test-command default selection needs side-effect-free config reads during previews, and dry-run reporting should account for all mutation paths.
