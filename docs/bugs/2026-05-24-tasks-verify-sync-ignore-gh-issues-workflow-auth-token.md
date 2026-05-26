# Tasks verify and sync ignore the gh-issues workflow auth token

## Summary

The `tasks verify` and `tasks sync` commands fail with `missing_auth` even when the workflow's configured `gh-issues` task backend includes an explicit authentication token.

## Environment

- Date reproduced: 2026-05-24
- Repository branch: `main`
- Package version: `0.0.0-dev`
- Runtime: local TypeScript CLI entrypoint with a disposable workflow file

## Reproduction

From the repository root, create a workflow whose GitHub Issues task backend contains an explicit token and run both project-management commands:

```sh
probe=$(mktemp -d)
mkdir -p "$probe/project"
cat > "$probe/project/WORKFLOW.md" <<'EOF'
---
tasks:
  type: gh-issues
  repo: octo/repo
  project:
    owner: octo-org
    number: 7
  auth:
    token: probe-token-that-should-be-used
states:
  Todo:
    prompt: Run it
  Done:
    terminal: true
---
# Workflow
EOF

(
  cd "$probe/project"
  /path/to/poe-code/node_modules/.bin/tsx \
    --import /path/to/poe-code/scripts/register-template-loader.mjs \
    /path/to/poe-code/src/index.ts tasks verify octo-org/7
)
(
  cd "$probe/project"
  /path/to/poe-code/node_modules/.bin/tsx \
    --import /path/to/poe-code/scripts/register-template-loader.mjs \
    /path/to/poe-code/src/index.ts tasks sync octo-org/7 --yes
)
```

Replace `/path/to/poe-code` with the repository checkout path.

## Observed Behavior

- `tasks verify octo-org/7` exits with `[error] missing_auth` before attempting project verification.
- `tasks sync octo-org/7 --yes` exits with `[error] missing_auth (op=lookup, target=auth)` before attempting synchronization.
- The `auth.token` declared in `WORKFLOW.md` does not affect either command.

## Expected Behavior

When the configured `gh-issues` task backend declares `auth.token`, `tasks verify` and `tasks sync` should use that configured credential consistently with normal task-list operations.

## Impact

- GitHub Project verification and setup commands cannot be used with workflow-scoped authentication tokens.
- Users must supply credentials through an undocumented alternate path or cannot manage the configured task project at all.
- The command behavior is inconsistent: `tasks comment` opens the configured backend and can use `tasks.auth.token`, while verify/sync reject the same workflow.

## Supporting Evidence

`src/cli/commands/tasks.ts` implements `runVerify(...)` and `runSync(...)` through `resolveTasksOptions(...)`, then passes that result to `verifyGhProject(...)` or `syncGhProject(...)`. In `src/cli/commands/tasks-options.ts`, `ResolvedTasksOptions` includes project/repo/state information but does not carry the workflow task backend's `auth` object. In `packages/task-list/src/backends/gh-issues-sync.ts`, `resolveGhClient(...)` requires `opts.auth.token` and otherwise throws `missing_auth`.

## Suspected Area

Project verify/sync option resolution must preserve the configured `gh-issues` authentication settings, or those commands must explicitly resolve auth using the same backend-opening path as other task operations.
