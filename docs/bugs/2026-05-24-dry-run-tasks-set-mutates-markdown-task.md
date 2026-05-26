# Dry-run tasks set mutates markdown task files

## Summary

Running `tasks set` with the global `--dry-run` flag still updates task files in the `markdown-dir` backend. The command reports a successful update and writes changes to disk instead of simulating the mutation.

## Environment

- Date reproduced: 2026-05-24
- Repository branch: `main`
- Package version: `0.0.0-dev`
- Runtime: local TypeScript CLI entrypoint

## Reproduction

From the repository root, create an isolated workflow workspace and invoke `tasks set` through the local CLI:

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
name: Original name
state: queued
priority: high
---

Original description
EOF

(
  cd "$probe/project"
  HOME="$probe/home" npx --prefix /path/to/poe-code tsx \
    --import /path/to/poe-code/scripts/register-template-loader.mjs \
    /path/to/poe-code/src/index.ts --dry-run tasks set plans/foo \
    --name 'Changed despite dry run' --workflow "$probe/project/WORKFLOW.md"
)

cat "$probe/project/tasks/plans/foo.md"
```

Replace `/path/to/poe-code` with the repository checkout path.

## Observed Behavior

The command prints:

```text
[info] Updated task plans/foo.
```

The task file is changed on disk: `name: Original name` becomes `name: Changed despite dry run`, and the backend additionally writes a `$schema` frontmatter field.

## Expected Behavior

With `--dry-run`, `tasks set` must leave the task file unchanged and report what would be updated instead of persisting modifications.

## Impact

- The advertised non-mutating mode does not protect task data.
- Users previewing task maintenance operations can unintentionally modify workflow state files.
- Automatic normalization changes such as adding `$schema` happen during a dry-run invocation.

## Supporting Evidence

The root CLI advertises `--dry-run` as `Simulate commands without writing changes.` in `src/cli/program.ts`. In `src/cli/commands/tasks.ts`, task update handlers call backend mutation methods without checking resolved global command flags.

## Suspected Area

The `tasks set`, `tasks set-state`, and `tasks next` handlers do not receive or enforce dry-run semantics before invoking task backend updates. This report directly reproduces the behavior through `tasks set`.
