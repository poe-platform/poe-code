# Resume unfinished pipeline finalization

## Required behavior

Task completion and finalization completion are separate durable facts. A normal
retry after failed/cancelled teardown or a failed archive must finish pending
finalization without rerunning completed tasks or setup. An acknowledged
successful teardown must not repeat merely because archiving failed.

When the last task or step finishes exactly at `maxRuns`, finalize that completed
plan without granting another task execution. A limit with unfinished work still
returns `max_runs`. Finalization-only recovery can run with a zero task budget.
Task-filtered completion must not finalize or archive a plan with other open
tasks. Preserve cancellation, callbacks, metrics, unrelated files, and the
selected-directory archive behavior fixed by POE-017.

## Durable state

Add an optional `finalization` field to the pipeline document, parser, schema,
and public plan types:

- `pending`: task execution has occurred, but finalization is not acknowledged.
- `teardown_completed`: teardown succeeded or is disabled; only final completion
  or archiving remains.
- `completed`: finalization succeeded, including an intentional no-archive run.

Persist `pending` in the same locked atomic document update as task status, not
before spawning an agent. Persist teardown acknowledgement before archiving.
Use the existing task-list archive metadata patch to write final completion in
the archive transition itself. Do not mark an active source completed before an
archive that can still fail. No-archive completion writes the terminal state to
the active document instead.

Progress updates must read current document contents under the existing status
lock and preserve tasks, comments, body, and unrelated metadata. If new open work
appears during teardown, do not acknowledge full completion or archive it; reload
the live plan and respect the remaining task budget. A new task execution resets
previous finalization acknowledgement. Keep the existing whole-run lock so two
retries cannot both execute the pending teardown.

## Compatibility and recovery limits

An already-complete plan without tracked finalization remains a no-op, as does a
plan with acknowledged finalization. Older releases did not record enough data
to distinguish failed finalization from intentional completion. Operators can
set `finalization: pending` on an otherwise complete legacy plan to request
teardown and completion, or `teardown_completed` when only archiving remains.
Do not silently infer that lost history or reopen completed tasks.

If an agent succeeds but its acknowledgement cannot be persisted, the phase may
run again on retry; this is not an exactly-once external-side-effect guarantee.
Successfully persisted teardown acknowledgement must survive later failures.
When changing previously acknowledged final checks intentionally, reset the
marker to `pending` if those checks must run again.

## Verification

Use memfs and injected runners for failed, thrown, and cancelled teardown;
exact task/step budgets; unfinished budgets; no-archive and legacy no-ops; archive
collisions and filesystem failures; progress-write failures; new requirements
added during teardown; task-filtered runs; reopened work; and concurrent retries.
Test parser/schema values, atomic task/progress updates, comments and line-ending
preservation, and archive metadata transitions.

Run the maintained build and full normal hooks. After GitHub publication, verify
the real public SDK on Node 18/20/22/24, including fresh-process recovery against
owned filesystem fixtures. Do not substitute checkout runtime code for the
released artifact or count skipped tests as passes.
