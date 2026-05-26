# Braintrust status rewrites invalid configuration

## Summary

Running `braintrust status` rewrites malformed global configuration while checking whether the integration is enabled. The status-only command replaces `.poe-code/config.json` with `{}` and creates an invalid-document backup before reporting `disabled`.

## Environment

- Date reproduced: 2026-05-24
- Repository branch: `main`
- Package version: `0.0.0-dev`
- Runtime: local TypeScript CLI entrypoint

## Reproduction

From the repository root, create a disposable home with malformed Poe configuration and query Braintrust status:

```sh
probe=$(mktemp -d)
mkdir -p "$probe/home/.poe-code" "$probe/project"
printf '{ invalid json\n' > "$probe/home/.poe-code/config.json"

(
  cd "$probe/project"
  HOME="$probe/home" npx --prefix /path/to/poe-code tsx \
    --import /path/to/poe-code/scripts/register-template-loader.mjs \
    /path/to/poe-code/src/index.ts braintrust status
)

find "$probe/home/.poe-code" -maxdepth 1 -type f -print -exec cat {} \;
```

Replace `/path/to/poe-code` with the repository checkout path.

## Observed Behavior

- The command displays `disabled` for Braintrust status.
- The malformed global `.poe-code/config.json` is overwritten with `{}`.
- A `.poe-code/config.json.invalid-<timestamp>.json` backup is created containing the original malformed input.

## Expected Behavior

Checking integration status must not modify configuration. Invalid config should be reported or treated as disabled without replacing files or creating backups during a read-only query.

## Impact

- Monitoring and diagnostic commands can mutate user home configuration.
- An integration reported as disabled still triggers irreversible replacement of the active config document.
- Automated status polling can generate unexpected recovery artifacts.

## Supporting Evidence

`src/cli/commands/braintrust.ts` obtains integration status through `resolveMergedDocument` before rendering output. Invalid configuration recovery in `packages/poe-code-config/src/store.ts` persists a replacement config and backup during this read path.

## Suspected Area

Read-only integration status commands need non-mutating configuration reads, with explicit repair separate from inspection.
