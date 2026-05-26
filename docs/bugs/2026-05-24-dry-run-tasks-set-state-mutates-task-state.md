# Dry-run tasks set-state persists a task state transition

## Summary

Running `tasks set-state` with `--dry-run` still transitions a task in the `markdown-dir` backend and rewrites its file on disk. The command changes workflow state during the advertised no-write preview mode.

## Environment

- Date reproduced: 2026-05-24
- Repository branch: `main`
- Package version: `0.0.0-dev`
- Runtime: local TypeScript CLI entrypoint

## Reproduction

From the repository root, create an isolated task workspace and attempt a dry-run state transition:

```sh
probe=$(mktemp -d)
mkdir -p "$probe/project/tasks/plans" "$probe/home"

cat > "$probe/project/WORKFLOW.md" <<EOF
---
tasks:
  type: markdown-dir
  path: $probe/project/tasks
states:
  queued:
    prompt: Run it
  done:
    terminal: true
---
# Workflow
EOF

cat > "$probe/project/tasks/plans/foo.md" <<'EOF'
---
kind: task
version: 1
name: Example
state: queued
priority: high
---

Description
EOF

(
  cd "$probe/project"
  HOME="$probe/home" npx --prefix /path/to/poe-code tsx \
    --import /path/to/poe-code/scripts/register-template-loader.mjs \
    /path/to/poe-code/src/index.ts --dry-run tasks set-state plans/foo done \
    --workflow "$probe/project/WORKFLOW.md"
)

rg '^state:|^\$schema:' "$probe/project/tasks/plans/foo.md"
```

Replace `/path/to/poe-code` with the repository checkout path.

## Observed Behavior

After the dry-run command finishes, the task file contains:

```yaml
state: done
$schema: https://poe-platform.github.io/poe-code/schemas/task-list/task.schema.json
```

The original state was `queued`, so the state transition was persisted despite `--dry-run`.

## Expected Behavior

With `--dry-run`, `tasks set-state` must leave the task state unchanged and report that a transition from `queued` to `done` would occur.

## Impact

- Previewing a workflow transition can move a real task into a terminal state.
- State-based agents or dashboards may treat a task as completed after a dry-run validation command.
- Backend normalization also modifies frontmatter during the supposedly non-mutating invocation.

## Supporting Evidence

The root CLI documents `--dry-run` as `Simulate commands without writing changes.` in `src/cli/program.ts`. In `src/cli/commands/tasks.ts`, `runSetState` calls `setTaskState`, which delegates directly to `tasks.fire` without reading or enforcing global dry-run flags.

## Suspected Area

Task state transition handlers need access to resolved execution flags and must avoid backend mutation calls when `dryRun` is enabled.
