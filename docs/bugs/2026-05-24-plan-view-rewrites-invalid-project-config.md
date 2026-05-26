# Plan view rewrites invalid project configuration

## Summary

Running `plan view` rewrites malformed project configuration while rendering a selected plan. The read-only viewer replaces `.poe-code/config.json` with `{}` and creates an invalid-document backup.

## Environment

- Date reproduced: 2026-05-24
- Repository branch: `main`
- Package version: `0.0.0-dev`
- Runtime: local TypeScript CLI entrypoint

## Reproduction

From the repository root, create a disposable project with malformed project config and one plan document:

```sh
probe=$(mktemp -d)
mkdir -p "$probe/home" "$probe/project/.poe-code" "$probe/project/docs/plans"
printf '{ invalid json\n' > "$probe/project/.poe-code/config.json"
printf '# One\n' > "$probe/project/docs/plans/one.md"

(
  cd "$probe/project"
  HOME="$probe/home" npx --prefix /path/to/poe-code tsx \
    --import /path/to/poe-code/scripts/register-template-loader.mjs \
    /path/to/poe-code/src/index.ts plan view docs/plans/one.md --output json
)

find "$probe/project/.poe-code" -maxdepth 1 -type f -print -exec cat {} \;
```

Replace `/path/to/poe-code` with the repository checkout path.

## Observed Behavior

- The command outputs JSON containing the selected plan content.
- The malformed `.poe-code/config.json` is replaced with `{}`.
- A `.poe-code/config.json.invalid-<timestamp>.json` backup is created with the original invalid input.

## Expected Behavior

Viewing a plan must not rewrite configuration. Invalid configuration should be surfaced without persistent recovery while performing an inspection-only operation.

## Impact

- Rendering documentation can unexpectedly modify repository state.
- Tooling that previews plan content can create configuration backup artifacts.
- The viewer changes active configuration without an explicit repair request.

## Supporting Evidence

`src/cli/commands/plan.ts` discovers plans before selecting and rendering one in `plan view`. Discovery reads the project configuration, and invalid-document recovery in `packages/poe-code-config/src/store.ts` persists a replacement and backup on the read path.

## Suspected Area

Plan viewer discovery must use side-effect-free configuration reads; repair behavior should be separated from read-only commands.
