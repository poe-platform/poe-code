# Superintendent plan-path rewrites invalid project configuration

## Summary

Running `superintendent plan-path` rewrites malformed project configuration while printing the directory where superintendent plan files belong.

## Environment

- Date reproduced: 2026-05-24
- Repository branch: `main`
- Package version: `0.0.0-dev`
- Runtime: local TypeScript CLI entrypoint

## Reproduction

From the repository root, create a disposable project with malformed project configuration and query the superintendent plan directory:

```sh
probe=$(mktemp -d)
mkdir -p "$probe/home" "$probe/project/.poe-code"
printf '{ invalid json\n' > "$probe/project/.poe-code/config.json"

(
  cd "$probe/project"
  HOME="$probe/home" npx --prefix /path/to/poe-code tsx \
    --import /path/to/poe-code/scripts/register-template-loader.mjs \
    /path/to/poe-code/src/index.ts superintendent plan-path
)

find "$probe/project/.poe-code" -maxdepth 1 -type f -print -exec cat {} \;
```

Replace `/path/to/poe-code` with the repository checkout path.

## Observed Behavior

- The command prints the expected `docs/plans` directory path.
- `.poe-code/config.json` is overwritten with `{}`.
- `.poe-code/config.json.invalid-<timestamp>.json` is created containing the malformed original.

## Expected Behavior

Printing the superintendent plan directory must be read-only. Invalid project configuration should not be repaired or backed up as a side effect of inspecting the resolved location.

## Impact

- A path lookup command silently dirties the project.
- Tooling that determines where to put plans can overwrite the malformed config before diagnosis.
- The same read-only configuration lookup has inconsistent safety expectations across workflows.

## Supporting Evidence

`packages/superintendent/src/commands/plan-path.ts` resolves the plan directory through `readMergedDocument`. Invalid-document recovery in `packages/poe-code-config/src/store.ts` writes replacement and backup files when malformed JSON is encountered during that read.

## Suspected Area

Superintendent plan-path resolution needs a non-mutating configuration read path.
