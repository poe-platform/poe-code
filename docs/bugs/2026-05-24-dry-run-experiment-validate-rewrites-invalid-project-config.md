# Dry-run experiment validate rewrites invalid project configuration

## Summary

Running `experiment validate` with `--dry-run` rewrites malformed project configuration before validating an otherwise valid experiment document. The read-oriented validation operation replaces `.poe-code/config.json` with `{}` and writes an invalid-document backup.

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

Try one change.
EOF

(
  cd "$probe/project"
  HOME="$probe/home" npx --prefix /path/to/poe-code tsx \
    --import /path/to/poe-code/scripts/register-template-loader.mjs \
    /path/to/poe-code/src/index.ts --dry-run experiment validate docs/plans/probe.md
)

find "$probe/project/.poe-code" -maxdepth 1 -type f -print -exec cat {} \;
```

Replace `/path/to/poe-code` with the repository checkout path.

## Observed Behavior

- The command reports `Experiment doc is valid.` for the supplied document.
- The malformed project `.poe-code/config.json` is overwritten with `{}`.
- A `.poe-code/config.json.invalid-<timestamp>.json` backup is created containing the original malformed input.

## Expected Behavior

Validating an experiment document, especially under `--dry-run`, must not repair or rewrite project configuration. Invalid configuration should be reported without persistent side effects during validation.

## Impact

- A validation command mutates project state while users are attempting only to inspect an experiment doc.
- Project configuration is silently replaced even when the document successfully validates.
- Dry-run validation can dirty repositories and create unexpected backup artifacts.

## Supporting Evidence

The root CLI describes `--dry-run` as `Simulate commands without writing changes.` in `src/cli/program.ts`. `src/cli/commands/experiment.ts` resolves experiment command configuration with `readMergedDocument` before validating the document, while malformed config recovery in `packages/poe-code-config/src/store.ts` persists a replacement and backup.

## Suspected Area

Read-only experiment commands need non-mutating configuration reads, and invalid-config recovery should be deferred to explicit repair/write operations.
