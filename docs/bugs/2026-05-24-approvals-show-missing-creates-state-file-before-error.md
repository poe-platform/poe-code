# Approvals show missing creates state file before error

## Summary

Running `approvals show` for a missing approval in a project with no approvals state creates `.poe-code/approvals.yaml` before returning its not-found error.

## Environment

- Date reproduced: 2026-05-24
- Repository branch: `main`
- Package version: `0.0.0-dev`
- Runtime: local TypeScript CLI entrypoint

## Reproduction

From the repository root, inspect a nonexistent approval in a clean disposable project:

```sh
probe=$(mktemp -d)
mkdir -p "$probe/home" "$probe/project"

(
  cd "$probe/project"
  HOME="$probe/home" npx --prefix /path/to/poe-code tsx \
    --import /path/to/poe-code/scripts/register-template-loader.mjs \
    /path/to/poe-code/src/index.ts approvals show --approval-id missing
)

find "$probe/project" -maxdepth 4 -print -exec sh -c 'test -f "$1" && cat "$1" || true' _ {} \;
```

Replace `/path/to/poe-code` with the repository checkout path.

## Observed Behavior

- The command fails with `Task "approvals/missing" not found.`
- Before returning that error, it creates `.poe-code/approvals.yaml` containing an empty task-store document.

## Expected Behavior

Inspecting a missing approval must not create approval state. The command should return its not-found error while leaving a clean project unchanged.

## Impact

- A failed read operation dirties the project.
- Diagnostic scripts that check whether an approval exists leave behind persistent state.
- Empty storage creation can conceal whether any approval workflow has actually been initialized.

## Supporting Evidence

`packages/toolcraft/src/human-in-loop/approvals-commands.ts` calls `ensureApprovalList` for `show` before requesting the selected task. `packages/toolcraft/src/human-in-loop/approval-tasks.ts` opens task storage with `create: true`, so the backing file is persisted before the missing-task failure is returned.

## Suspected Area

Read-only approval lookup needs a non-creating task-store access path.
