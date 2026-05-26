# Dry-run experiment install rewrites invalid config while reporting no changes

## Summary

Running `experiment install` with `--dry-run --yes` and no explicit agent rewrites malformed global configuration while resolving the default agent, then reports `# no filesystem changes`. Its displayed skill/scaffold operations remain previews, but invalid-config recovery is written to disk.

## Environment

- Date reproduced: 2026-05-24
- Repository branch: `main`
- Package version: `0.0.0-dev`
- Runtime: local TypeScript CLI entrypoint

## Reproduction

From the repository root, create a disposable home with malformed configuration and preview experiment installation:

```sh
probe=$(mktemp -d)
mkdir -p "$probe/home/.poe-code" "$probe/project"
printf '{ invalid json\n' > "$probe/home/.poe-code/config.json"

(
  cd "$probe/project"
  HOME="$probe/home" npx --prefix /path/to/poe-code tsx \
    --import /path/to/poe-code/scripts/register-template-loader.mjs \
    /path/to/poe-code/src/index.ts --dry-run --yes experiment install --local
)

find "$probe/home/.poe-code" -maxdepth 1 -type f -print -exec cat {} \;
```

Replace `/path/to/poe-code` with the repository checkout path.

## Observed Behavior

The command previews creation of the experiment skill, experiments directory, and `run.yaml`, then prints `# no filesystem changes`. It still changes files in the disposable home:

- `.poe-code/config.json` is overwritten with `{}`.
- `.poe-code/config.json.invalid-<timestamp>.json` is created containing the original malformed input.

## Expected Behavior

With `--dry-run`, experiment installation must not mutate configuration while selecting default setup values, and its output must not state that no changes occurred after persisted recovery writes.

## Impact

- Previewing experiment scaffolding unexpectedly changes user configuration.
- The dry-run transcript is unreliable for auditing filesystem effects.
- Malformed config is replaced during a command intended only to show prospective setup operations.

## Supporting Evidence

The root CLI documents `--dry-run` as `Simulate commands without writing changes.` in `src/cli/program.ts`. `src/cli/commands/experiment.ts` resolves its default installer agent through `resolveDefaultAgent`, while invalid-document recovery in `packages/poe-code-config/src/store.ts` writes replacement and backup files on config read.

## Suspected Area

Experiment installer previews need non-mutating default resolution and dry-run reporting that cannot omit automatic recovery writes.
