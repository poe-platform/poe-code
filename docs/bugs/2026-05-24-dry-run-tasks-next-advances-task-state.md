# Dry-run tasks next advances task state

## Summary

Running `tasks next` with the root `--dry-run` option still persists the automatic transition to the next workflow state.

## Environment

- Date reproduced: 2026-05-24
- Repository branch: `main`
- Package version: `0.0.0-dev`
- Runtime: local TypeScript CLI entrypoint with a disposable Markdown task backend

## Reproduction

From the repository root, create a disposable workflow with an ordered task state list and preview advancement:

```sh
probe=$(mktemp -d)
mkdir -p "$probe/home" "$probe/project/tasks/plans"
cat > "$probe/project/WORKFLOW.md" <<EOF
---
tasks:
  type: markdown-dir
  path: $probe/project/tasks
states:
  queued:
    prompt: Run it
  agent-running:
    prompt: Keep going
  done:
    terminal: true
---
# Workflow
EOF
cat > "$probe/project/tasks/plans/foo.md" <<'EOF'
---
kind: task
version: 1
name: Foo task
state: queued
---

Initial description
EOF

(
  cd "$probe/project"
  HOME="$probe/home" /path/to/poe-code/node_modules/.bin/tsx \
    --import /path/to/poe-code/scripts/register-template-loader.mjs \
    /path/to/poe-code/src/index.ts --dry-run tasks next plans/foo --yes
)

cat "$probe/project/tasks/plans/foo.md"
```

Replace `/path/to/poe-code` with the repository checkout path.

## Observed Behavior

- The command emits no dry-run preview message and returns successfully.
- The task file is rewritten from `state: queued` to `state: agent-running`.
- Serialization also adds the task schema field to the persisted frontmatter.

## Expected Behavior

With root `--dry-run`, automatic advancement must not change task files. It should report the calculated next transition without persisting it.

## Impact

- A preview can start or advance workflow processing unexpectedly.
- Silent state changes can affect automation selection, task queues, and audit history.
- Additional serialization edits are saved with the unintended transition.

## Supporting Evidence

The root CLI advertises `--dry-run` as `Simulate commands without writing changes.` in `src/cli/program.ts`. `src/cli/commands/tasks.ts` implements `runNext` by computing the next state and calling `setTaskState`, which fires the backend transition without reading or guarding the root dry-run option.

## Suspected Area

Task transition commands need execution-resource integration or explicit dry-run guards before firing backend events.
