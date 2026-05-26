# Pipeline plan-path rewrites invalid project configuration

## Summary

Running `pipeline plan-path` rewrites malformed project configuration while computing the directory path it prints. This informational command replaces `.poe-code/config.json` with `{}` and creates an invalid-document backup.

## Environment

- Date reproduced: 2026-05-24
- Repository branch: `main`
- Package version: `0.0.0-dev`
- Runtime: local TypeScript CLI entrypoint

## Reproduction

From the repository root, create a disposable project with malformed project configuration and ask for its pipeline plan path:

```sh
probe=$(mktemp -d)
mkdir -p "$probe/home" "$probe/project/.poe-code"
printf '{ invalid json\n' > "$probe/project/.poe-code/config.json"

(
  cd "$probe/project"
  HOME="$probe/home" npx --prefix /path/to/poe-code tsx \
    --import /path/to/poe-code/scripts/register-template-loader.mjs \
    /path/to/poe-code/src/index.ts pipeline plan-path
)

find "$probe/project/.poe-code" -maxdepth 1 -type f -print -exec cat {} \;
```

Replace `/path/to/poe-code` with the repository checkout path.

## Observed Behavior

- The command prints the resolved pipeline plan directory path.
- The malformed project `.poe-code/config.json` is overwritten with `{}`.
- A `.poe-code/config.json.invalid-<timestamp>.json` backup is created containing the original malformed input.

## Expected Behavior

Printing a pipeline path must be a read-only operation. Invalid project configuration should be surfaced without replacement files or backups unless the user explicitly requests repair.

## Impact

- Scripts that query pipeline locations can silently dirty repositories.
- A read-only command alters configuration before any pipeline work is requested.
- Unanticipated backup files are generated during tooling discovery operations.

## Supporting Evidence

`src/cli/commands/pipeline.ts` implements `pipeline plan-path` by calling `resolvePipelineCommandConfig`, which reads merged configuration through `readMergedDocument`. Invalid configuration recovery in `packages/poe-code-config/src/store.ts` persists the replacement and backup during that read.

## Suspected Area

Read-only configuration consumers should use non-mutating parse behavior, and invalid-config recovery should be explicit rather than automatic on reads.
