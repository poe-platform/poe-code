# POE-012: preserve manual completion during active execution

## Required behavior

- A successful `complete` command is terminal for an active loop. Preserve the
  completed document, reason, task board, round, and review count.
- Let an already running role settle, but do not dispatch another role, reopen
  status, or let stale role transitions, failures, or abort rollback undo manual
  completion. Report the loop stop reason as `completed`.
- Recheck completion at role boundaries, including callbacks that defer dispatch
  and coordinator exchanges during review. Direct persisted completion also
  stops the loop at the next boundary.
- Serialize command completion and loop status transactions across filesystem
  clients. Hold the per-document status lock only for reads/writes and dispatch,
  never while waiting for an agent. A status write prepared before completion
  must not replace it afterward.
- Bound lock contention and provide the lock pathname and recovery guidance if a
  process abandoned it. Do not automatically remove a possibly active lock.
- Preserve dry-run behavior and ordinary review/approval, pause, stop, and abort
  behavior when no persisted completion exists. Add no command-line flags.

## Validation and delivery

Use memfs, deferred fake role results, and real completion/role wrappers. Cover
all roles, role failure, review continuation, deferred dispatch, status-write
interleavings, abort precedence, direct document completion, and dry-run controls.
Run package tests and maintained repository build/test routes, inspect the CLI
completion output, commit only this fix, push to main, and verify the published
npm artifact. Do not change README files without separate permission.

POE-013 runner isolation and the other audit findings remain separate work.
