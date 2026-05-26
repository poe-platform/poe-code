# Plan list rewrites invalid project configuration

## Summary

Running `plan list` rewrites malformed project configuration while discovering plans for read-only output. The command replaces `.poe-code/config.json` with `{}` and creates an invalid-document backup before returning the plan list.

## Environment

- Date reproduced: 2026-05-24
- Repository branch: `main`
- Package version: `0.0.0-dev`
- Runtime: local TypeScript CLI entrypoint

## Reproduction

From the repository root, create a disposable project containing malformed project config and one plan document:

```sh
probe=$(mktemp -d)
mkdir -p "$probe/home" "$probe/project/.poe-code" "$probe/project/docs/plans"
printf '{ invalid json\n' > "$probe/project/.poe-code/config.json"
printf '# One\n' > "$probe/project/docs/plans/one.md"

(
  cd "$probe/project"
  HOME="$probe/home" npx --prefix /path/to/poe-code tsx \
    --import /path/to/poe-code/scripts/register-template-loader.mjs \
    /path/to/poe-code/src/index.ts plan list --output json
)

find "$probe/project/.poe-code" -maxdepth 1 -type f -print -exec cat {} \;
```

Replace `/path/to/poe-code` with the repository checkout path.

## Observed Behavior

- The command outputs JSON for `docs/plans/one.md` as expected.
- The malformed `.poe-code/config.json` is overwritten with `{}`.
- A `.poe-code/config.json.invalid-<timestamp>.json` file is created with the original invalid content.

## Expected Behavior

Listing plans must be read-only. Invalid configuration should be reported without modifying project files or creating recovery backups during discovery.

## Impact

- An informational inventory command can dirty the project worktree.
- Scripts that list plans for dashboards or tooling can silently alter configuration.
- Invalid project config is replaced before the user elects to repair it.

## Supporting Evidence

`src/cli/commands/plan.ts` implements `plan list` through `discoverPlans`, which delegates to plan discovery with global and project config paths. That discovery reads configuration, and invalid-document recovery in `packages/poe-code-config/src/store.ts` writes replacement and backup files.

## Suspected Area

Plan discovery and read-only list commands need non-mutating config reads; automatic recovery should be explicit rather than triggered during inspection.
