# Dry-run pipeline install rewrites invalid config while reporting no changes

## Summary

Running `pipeline install` with `--dry-run --yes` and no explicit agent rewrites malformed global configuration while selecting the default agent, then reports `# no filesystem changes`. The scaffold preview itself is non-persistent, but configuration recovery is persisted.

## Environment

- Date reproduced: 2026-05-24
- Repository branch: `main`
- Package version: `0.0.0-dev`
- Runtime: local TypeScript CLI entrypoint

## Reproduction

From the repository root, create a disposable home with malformed configuration and preview pipeline installation:

```sh
probe=$(mktemp -d)
mkdir -p "$probe/home/.poe-code" "$probe/project"
printf '{ invalid json\n' > "$probe/home/.poe-code/config.json"

(
  cd "$probe/project"
  HOME="$probe/home" npx --prefix /path/to/poe-code tsx \
    --import /path/to/poe-code/scripts/register-template-loader.mjs \
    /path/to/poe-code/src/index.ts --dry-run --yes pipeline install --local
)

find "$probe/home/.poe-code" -maxdepth 1 -type f -print -exec cat {} \;
```

Replace `/path/to/poe-code` with the repository checkout path.

## Observed Behavior

The command previews creation of the pipeline skill, plan directory, and `steps.yaml`, then prints `# no filesystem changes`. Nevertheless:

- `.poe-code/config.json` is overwritten with `{}`.
- `.poe-code/config.json.invalid-<timestamp>.json` is created containing the malformed original.

## Expected Behavior

With `--dry-run`, pipeline installation must not persist configuration repairs or any other filesystem mutations while resolving default choices or rendering its scaffold preview.

## Impact

- A scaffold preview silently modifies global configuration.
- Output directly contradicts actual filesystem changes.
- CI or onboarding tooling that evaluates pipeline setup can dirty user state unexpectedly.

## Supporting Evidence

The root CLI advertises `--dry-run` as `Simulate commands without writing changes.` in `src/cli/program.ts`. `src/cli/commands/pipeline.ts` resolves its selected agent through `resolveDefaultAgent` before performing dry-run scaffold reporting, and invalid recovery in `packages/poe-code-config/src/store.ts` persists replacement and backup files.

## Suspected Area

Pipeline installer previews need side-effect-free default/config resolution and accurate accounting of any filesystem mutation.
