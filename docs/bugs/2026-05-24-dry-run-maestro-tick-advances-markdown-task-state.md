# Dry-run maestro tick advances a Markdown task state

## Summary

Running `maestro tick` with the root `--dry-run` option still fires the queued trigger and rewrites a Markdown task from `queued` to `agent-running`.

## Environment

- Date reproduced: 2026-05-24
- Repository branch: `main`
- Package version: `0.0.0-dev`
- Runtime: local TypeScript CLI entrypoint with a disposable Markdown task list

## Reproduction

From the repository root, create a disposable Maestro workflow and one queued Markdown task, then issue its queued-trigger tick through root dry-run mode:

```sh
probe=$(mktemp -d)
mkdir -p "$probe/tasks/maestro"
cat > "$probe/WORKFLOW.md" <<'EOF'
---
tasks:
  type: markdown-dir
  path: ./tasks
states:
  queued:
    prompt: "work:{{ task.id }}"
  agent-running:
    prompt: "work:{{ task.id }}"
  human-review:
    prompt: "review:{{ task.id }}"
  done:
    terminal: true
  failed:
    terminal: true
  archived:
    terminal: true
agent:
  service: codex
  list: maestro
---
# Probe workflow
EOF

cat > "$probe/tasks/maestro/one.md" <<'EOF'
---
$schema: https://poe-platform.github.io/poe-code/schemas/task-list/task.schema.json
kind: task
version: 1
name: Probe task
state: queued
---

Probe body
EOF
cp "$probe/tasks/maestro/one.md" "$probe/before.md"

(
  cd "$probe"
  /path/to/poe-code/node_modules/.bin/tsx \
    --import /path/to/poe-code/scripts/register-template-loader.mjs \
    /path/to/poe-code/src/index.ts --dry-run maestro tick \
    --config "$probe/WORKFLOW.md" --task maestro/one --transition '*:queued'
)

diff -u "$probe/before.md" "$probe/tasks/maestro/one.md" || true
```

Replace `/path/to/poe-code` with the repository checkout path.

## Observed Behavior

- The command exits successfully and emits a `tick_started` JSON event.
- Despite root `--dry-run`, the task file is rewritten from `state: queued` to `state: agent-running`.

## Expected Behavior

With root `--dry-run`, `maestro tick` must not fire a task transition or modify task storage. It should preview or report the prospective event/transition only.

## Impact

- A simulated external trigger advances real workflow state on disk.
- Automation using dry-run to validate Maestro webhook/tick arguments can accidentally schedule work.
- Task audit history no longer reflects user intent because preview actions become persisted state changes.

## Supporting Evidence

The root CLI advertises `--dry-run` as `Simulate commands without writing changes.` in `src/cli/program.ts`. The `maestro` root command handles a `dryRun` option, but its `tick` subcommand invokes `runMaestroTick(...)` without passing or checking any dry-run flag. In `packages/agent-maestro/src/tick-command.ts`, the `*:queued` trigger opens the configured task list and calls `advanceTaskToRunning(...)`, which fires the `agent-running` event and persists the Markdown backend update.

## Suspected Area

The Maestro tick command must receive resolved root flags and bypass task-transition firing when dry-run is enabled.
