# Dry-run runtime jobs ls persists reconciled job status

## Summary

Running `runtime jobs ls` with `--dry-run` still rewrites saved runtime job state. When a recorded running sandbox cannot be attached, the listing command persists `status: lost` to the job file during the purported no-write simulation mode.

## Environment

- Date reproduced: 2026-05-24
- Repository branch: `main`
- Package version: `0.0.0-dev`
- Runtime: local TypeScript CLI entrypoint

## Reproduction

From the repository root, seed an isolated detached-job record that points to a nonexistent Docker environment:

```sh
probe=$(mktemp -d)
mkdir -p "$probe/home/.poe-code/state/jobs" "$probe/project"

cat > "$probe/home/.poe-code/state/jobs/job-missing.json" <<'EOF'
{
  "id": "job-missing",
  "tool": "codex",
  "argv": ["codex"],
  "cwd": "/tmp/project",
  "env_kind": "docker",
  "env_id": "definitely-missing-container",
  "status": "running",
  "started_at": "2026-05-24T10:00:00.000Z"
}
EOF

(
  cd "$probe/project"
  HOME="$probe/home" npx --prefix /path/to/poe-code tsx \
    --import /path/to/poe-code/scripts/register-template-loader.mjs \
    /path/to/poe-code/src/index.ts --dry-run runtime jobs ls
)

rg '"status"' "$probe/home/.poe-code/state/jobs/job-missing.json"
```

Replace `/path/to/poe-code` with the repository checkout path.

## Observed Behavior

The table renders the seeded job with status `lost`. After the command returns, the persisted job JSON has changed from:

```json
"status": "running"
```

to:

```json
"status": "lost"
```

## Expected Behavior

With `--dry-run`, `runtime jobs ls` may display the reconciled status it would save, but it must not update job state files on disk.

## Impact

- A preview/listing command modifies detached job metadata.
- Operators testing runtime visibility under dry-run can permanently change the state used by follow-up commands.
- A transient attach failure can be persisted as `lost` even when no writes were requested.

## Supporting Evidence

The root CLI documents `--dry-run` as `Simulate commands without writing changes.` in `src/cli/program.ts`. The `reconcileRunningJobs` function in `src/cli/commands/runtime/jobs/ls.ts` calls `state.jobs.update` while producing listing results and does not check `flags.dryRun`.

## Suspected Area

Runtime job reconciliation should separate computed display state from persisted state, and skip updates entirely when invoked in dry-run mode.
