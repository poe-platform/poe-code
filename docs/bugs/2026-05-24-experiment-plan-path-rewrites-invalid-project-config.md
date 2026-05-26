# Experiment plan-path rewrites invalid project configuration

## Summary

Running `experiment plan-path` rewrites malformed project configuration while computing a directory path to print. The command is observational, but it replaces `.poe-code/config.json` with `{}` and creates an invalid-document backup.

## Environment

- Date reproduced: 2026-05-24
- Repository branch: `main`
- Package version: `0.0.0-dev`
- Runtime: local TypeScript CLI entrypoint

## Reproduction

From the repository root, create a disposable project with malformed project configuration and request the experiment plan path:

```sh
probe=$(mktemp -d)
mkdir -p "$probe/home" "$probe/project/.poe-code"
printf '{ invalid json\n' > "$probe/project/.poe-code/config.json"

(
  cd "$probe/project"
  HOME="$probe/home" npx --prefix /path/to/poe-code tsx \
    --import /path/to/poe-code/scripts/register-template-loader.mjs \
    /path/to/poe-code/src/index.ts experiment plan-path
)

find "$probe/project/.poe-code" -maxdepth 1 -type f -print -exec cat {} \;
```

Replace `/path/to/poe-code` with the repository checkout path.

## Observed Behavior

- The command prints the resolved plans directory path.
- The malformed project `.poe-code/config.json` is overwritten with `{}`.
- A `.poe-code/config.json.invalid-<timestamp>.json` backup is created containing the original malformed input.

## Expected Behavior

Printing a derived path must not repair or rewrite project configuration. The command should read configuration without side effects or report invalid configuration without modifying files.

## Impact

- Shell scripts that query the plan directory can silently dirty the repository.
- An informational command replaces invalid configuration without user authorization.
- Backup artifacts may be generated during command substitution or tooling integrations.

## Supporting Evidence

`src/cli/commands/experiment.ts` implements `experiment plan-path` by calling `resolveExperimentCommandConfig`, which uses `readMergedDocument`. Invalid configuration recovery in `packages/poe-code-config/src/store.ts` persists a replacement document and `.invalid-<timestamp>.json` backup during that read.

## Suspected Area

Read-only configuration consumers should not trigger persistent invalid-document recovery; recovery should be explicit or performed only in mutating workflows.
