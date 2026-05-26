# Dry-run experiment journal log rewrites invalid config while reporting no changes

## Summary

Running `experiment journal log` with `--dry-run` rewrites malformed project configuration before simulating the journal append, then reports `# no filesystem changes`. The project config is replaced with `{}` and backed up even though no journal entry is written.

## Environment

- Date reproduced: 2026-05-24
- Repository branch: `main`
- Package version: `0.0.0-dev`
- Runtime: local TypeScript CLI entrypoint

## Reproduction

From the repository root, create a disposable project with malformed project config and an experiment document:

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
    /path/to/poe-code/src/index.ts --dry-run experiment journal log \
    docs/plans/probe.md --status keep --commit abc123
)

find "$probe/project/.poe-code" -maxdepth 1 -type f -print -exec cat {} \;
```

Replace `/path/to/poe-code` with the repository checkout path.

## Observed Behavior

The command prints:

```text
Would log keep entry (commit: abc123)
# no filesystem changes
```

It does not create the journal entry, but it does alter project configuration:

- `.poe-code/config.json` is overwritten with `{}`.
- `.poe-code/config.json.invalid-<timestamp>.json` is created containing the original malformed input.

## Expected Behavior

With `--dry-run`, previewing a journal append must not repair or rewrite configuration, and it must not claim no filesystem changes after any persisted write occurs.

## Impact

- Previewing experiment history updates can unexpectedly dirty project state.
- Users receive a false confirmation that no files changed.
- Invalid configuration is replaced before the requested journal operation is approved.

## Supporting Evidence

The root CLI describes `--dry-run` as `Simulate commands without writing changes.` in `src/cli/program.ts`. The `experiment journal log` handler in `src/cli/commands/experiment.ts` resolves experiment configuration before its `flags.dryRun` journal-write guard, while invalid config recovery in `packages/poe-code-config/src/store.ts` writes replacement and backup files.

## Suspected Area

Dry-run journal operations need non-mutating config reads, and filesystem-change reporting must include any recovery writes performed before the explicit mutation guard.
