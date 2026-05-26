# Experiment journal rewrites invalid project configuration

## Summary

Running `experiment journal` rewrites malformed project configuration while rendering the journal table. The read-only display command replaces `.poe-code/config.json` with `{}` and creates an invalid-document backup.

## Environment

- Date reproduced: 2026-05-24
- Repository branch: `main`
- Package version: `0.0.0-dev`
- Runtime: local TypeScript CLI entrypoint

## Reproduction

From the repository root, create a disposable project with malformed project config and a valid experiment document:

```sh
probe=$(mktemp -d)
mkdir -p "$probe/home" "$probe/project/docs/plans" "$probe/project/.poe-code"
printf '{ invalid json\n' > "$probe/project/.poe-code/config.json"

cat > "$probe/project/docs/plans/probe.md" <<'EOF'
---
agent: codex
metric:
  name: tests
  script: printf 1
  direction: maximize
---
# Probe
EOF

(
  cd "$probe/project"
  HOME="$probe/home" npx --prefix /path/to/poe-code tsx \
    --import /path/to/poe-code/scripts/register-template-loader.mjs \
    /path/to/poe-code/src/index.ts experiment journal docs/plans/probe.md
)

find "$probe/project/.poe-code" -maxdepth 1 -type f -print -exec cat {} \;
```

Replace `/path/to/poe-code` with the repository checkout path.

## Observed Behavior

- The command renders an experiment journal table for the supplied document.
- The malformed project `.poe-code/config.json` is overwritten with `{}`.
- A `.poe-code/config.json.invalid-<timestamp>.json` backup is created containing the original malformed input.

## Expected Behavior

Displaying an experiment journal must not alter project configuration. Invalid configuration should be reported without persistent repair during an inspection-only command.

## Impact

- A reporting command silently dirties project state.
- Reading experiment history can replace active malformed configuration before the user chooses any repair action.
- Automation that displays journals may generate unexpected recovery artifacts.

## Supporting Evidence

`src/cli/commands/experiment.ts` resolves experiment command configuration through `readMergedDocument` before loading journal data. Invalid configuration recovery in `packages/poe-code-config/src/store.ts` persists a replacement config and `.invalid-<timestamp>.json` backup on that read path.

## Suspected Area

Experiment inspection commands should read configuration without side effects; repair should be an explicit operation rather than automatic recovery on read.
