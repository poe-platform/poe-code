# Memory status rewrites invalid project configuration

## Summary

Running `memory status` rewrites malformed project configuration while calculating status for an initialized memory directory.

## Environment

- Date reproduced: 2026-05-24
- Repository branch: `main`
- Package version: `0.0.0-dev`
- Runtime: local TypeScript CLI entrypoint

## Reproduction

From the repository root, create initialized disposable memory and request status without token calculations:

```sh
probe=$(mktemp -d)
mkdir -p "$probe/home" "$probe/project/.poe-code/memory/pages"
printf '{ invalid json\n' > "$probe/project/.poe-code/config.json"
printf '# Memory Index\n' > "$probe/project/.poe-code/memory/INDEX.md"
printf '# Memory Log\n' > "$probe/project/.poe-code/memory/LOG.md"
printf -- '---\ndescription: Probe page\n---\nneedle value\n' > "$probe/project/.poe-code/memory/pages/probe.md"

(
  cd "$probe/project"
  HOME="$probe/home" npx --prefix /path/to/poe-code tsx \
    --import /path/to/poe-code/scripts/register-template-loader.mjs \
    /path/to/poe-code/src/index.ts memory status --no-tokens
)

find "$probe/project/.poe-code" -maxdepth 1 -type f -print -exec cat {} \;
```

Replace `/path/to/poe-code` with the repository checkout path.

## Observed Behavior

- The command prints memory page and byte status successfully.
- `.poe-code/config.json` is overwritten with `{}`.
- `.poe-code/config.json.invalid-<timestamp>.json` is created containing the malformed original.

## Expected Behavior

Status inspection must not mutate project configuration. Malformed config should be reported or handled without persistent repair during a read-only status operation.

## Impact

- Monitoring memory state silently alters configuration state.
- Status checks used in scripts or diagnostics can dirty the repository.
- The original malformed file is relocated before an explicit repair choice.

## Supporting Evidence

`src/cli/commands/memory.ts` resolves the configured memory root before computing status. That lookup uses `packages/memory/src/resolve-root.ts`, while invalid-document recovery in `packages/poe-code-config/src/store.ts` writes replacement and backup files during the read.

## Suspected Area

Memory status requires a non-mutating configuration read path.
