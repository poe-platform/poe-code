# Approvals list creates state file during read

## Summary

Running `approvals list` in a project with no approvals state creates `.poe-code/approvals.yaml`, even though the command only reports that no approvals exist.

## Environment

- Date reproduced: 2026-05-24
- Repository branch: `main`
- Package version: `0.0.0-dev`
- Runtime: local TypeScript CLI entrypoint

## Reproduction

From the repository root, list approvals in a clean disposable project:

```sh
probe=$(mktemp -d)
mkdir -p "$probe/home" "$probe/project"

(
  cd "$probe/project"
  HOME="$probe/home" npx --prefix /path/to/poe-code tsx \
    --import /path/to/poe-code/scripts/register-template-loader.mjs \
    /path/to/poe-code/src/index.ts approvals list
)

find "$probe/project" -maxdepth 4 -print -exec sh -c 'test -f "$1" && cat "$1" || true' _ {} \;
```

Replace `/path/to/poe-code` with the repository checkout path.

## Observed Behavior

- The command reports `No approvals found.` and exits successfully.
- The command creates `.poe-code/approvals.yaml` containing an empty task-store document.

## Expected Behavior

Listing approvals must be read-only when no state exists. It should report an empty list without creating the approval-store directory or file.

## Impact

- Merely inspecting approvals dirties otherwise clean projects.
- Status dashboards and scripts can introduce untracked state files.
- Users cannot distinguish intentional queued-approval state from artifacts created by inspection.

## Supporting Evidence

`src/cli/program.ts` exposes `approvals` through the forwarded Toolcraft command mechanism. `packages/toolcraft/src/human-in-loop/approvals-commands.ts` calls `ensureApprovalList` for `list`, and `packages/toolcraft/src/human-in-loop/approval-tasks.ts` opens its task list with `create: true` during that read.

## Suspected Area

Approval inspection should open task storage in non-creating mode unless a command is enqueueing or transitioning an approval.
