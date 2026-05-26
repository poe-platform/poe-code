# Dry-run pipeline run rewrites invalid config while promising no writes

## Summary

Running `pipeline run` with `--dry-run` rewrites malformed project configuration while preparing a preview, even though the output says it will not write plan or archive changes. The command replaces `.poe-code/config.json` with `{}` and creates an invalid-document backup during simulation.

## Environment

- Date reproduced: 2026-05-24
- Repository branch: `main`
- Package version: `0.0.0-dev`
- Runtime: local TypeScript CLI entrypoint

## Reproduction

From the repository root, create a disposable project with malformed project configuration and a minimal pipeline plan:

```sh
probe=$(mktemp -d)
mkdir -p "$probe/home" "$probe/project/docs/plans" "$probe/project/.poe-code"
printf '{ invalid json\n' > "$probe/project/.poe-code/config.json"

cat > "$probe/project/docs/plans/pipeline.md" <<'EOF'
---
kind: pipeline
tasks:
  - id: task-one
    title: One
    prompt: Do one thing.
    status: open
---
# Probe
EOF

(
  cd "$probe/project"
  HOME="$probe/home" npx --prefix /path/to/poe-code tsx \
    --import /path/to/poe-code/scripts/register-template-loader.mjs \
    /path/to/poe-code/src/index.ts --dry-run --yes pipeline run \
    --plan docs/plans/pipeline.md
)

find "$probe/project/.poe-code" -maxdepth 1 -type f -print -exec cat {} \;
```

Replace `/path/to/poe-code` with the repository checkout path.

## Observed Behavior

The command renders a dry-run preview that includes:

```text
Would run: docs/plans/pipeline.md
Would not spawn agents or write plan/archive changes.
```

Nevertheless, it mutates the isolated project:

- `.poe-code/config.json` is overwritten with `{}`.
- `.poe-code/config.json.invalid-<timestamp>.json` is created containing the original malformed input.

## Expected Behavior

With `--dry-run`, pipeline preview execution must not persist configuration recovery files or any other writes. If configuration is invalid, it should report that issue without altering the project.

## Impact

- The preview output implies safe simulation while project files are altered.
- CI or review workflows that dry-run pipeline plans can unexpectedly dirty worktrees.
- Invalid configuration is replaced before the user authorizes any repair or pipeline run.

## Supporting Evidence

The root CLI describes `--dry-run` as `Simulate commands without writing changes.` in `src/cli/program.ts`. The dry-run branch in `src/cli/commands/pipeline.ts` calls `resolvePipelineCommandConfig`, which reads merged configuration before preview output; invalid recovery in `packages/poe-code-config/src/store.ts` writes the replacement and backup.

## Suspected Area

Pipeline dry-run configuration reads should be non-mutating, and automatic recovery should not bypass preview guarantees.
