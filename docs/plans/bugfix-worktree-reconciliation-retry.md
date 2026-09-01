# Retry interrupted worktree reconciliation (POE-007)

## User-facing failure

A reconciliation agent can leave conflicts or partially applied changes in the
source checkout. Retrying then rejects those changes before the recovery agent
can run. Thrown agent errors also leave the registry marked as reconciling rather
than recording a recoverable failure.

## Required behavior

- Retain the clean-destination requirement for fresh reconciliation attempts.
- Allow an explicit retry with a recorded `conflicted` or `cleanup_failed`
  reconciliation to continue with its existing destination changes.
- Resume the recorded agent thread when available, retaining it if a later
  response omits a thread ID.
- Tell the recovery agent to preserve partial changes and user conflict
  resolutions and finish an existing merge before starting another.
- Record thrown or cancelled reconciliation and cleanup failures, preserving the
  original exception. If recording also fails, report both errors.
- Keep normal conflict, transfer, and worktree-removal verification unchanged.

## Implementation and verification

1. Add real SDK/core regressions using memfs, injected agents, and fake Git.
2. Reproduce failed retries before changing production code.
3. Update the worktree package's reconciliation state handling and prompts.
4. Verify retry outcomes, fresh-run guards, thread retention, cancellation,
   retained file contents, and failure-recording errors.
5. Run focused and root tests, the normal build, type checks, compiled public-SDK
   checks across supported local Node versions, and adjacent CLI screenshot QA.
6. Commit only this fix and its tests/plan using normal hooks. Report push and
   release separately; existing native prerequisite failures are not passes.
