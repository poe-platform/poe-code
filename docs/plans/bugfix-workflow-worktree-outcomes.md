# Preserve unsuccessful isolated workflow runs

POE-010: Ralph and Pipeline resolve failed or cancelled workflow results rather
than throwing. Promise resolution alone must not authorize reconciliation.

## Required behavior

- The generic worktree runner accepts an optional typed `isSuccessful` outcome
  classifier. Existing generic callers without a classifier retain their normal
  resolved-value behavior; results are not interpreted by object shape.
- Ralph allows `completed` and `max_iterations` to reconcile. Pipeline allows
  `completed`, `max_runs`, and `nothing_to_run`. Failed or cancelled results are
  returned unchanged without invoking a reconciliation or cleanup agent.
- An unsuccessful resolved run retains its worktree and branch, including an
  empty worktree, and marks the registry and returned worktree status failed.
  The registry records whether committed and uncommitted changes remain.
- An aborted run must not launch reconciliation or empty-worktree cleanup after
  its callback settles. Existing non-cancelled thrown-error cleanup behavior
  remains unchanged, as does direct execution without worktree isolation.
- CLI Pipeline sequences distinguish failure/cancellation from a normal run
  limit. Failure in a later plan preserves all work from the sequence rather
  than reconciling earlier partial results. Existing exit codes and visible
  messages remain unchanged.

## Validation

Use regression tests at the generic worktree boundary, SDK outcome adapters,
and CLI sequence boundary. Execute real Ralph/Pipeline cores and real worktree
registry/reconciliation logic with memfs, fake Git, and fake agents to prove
that failed/cancelled output stays isolated while successful work still transfers.
Check every declared SDK stop reason and preserve original result identity.
Run the affected suites, normal build, and normal commit hooks. Publication
requires the unchanged normal push and GitHub release gates; local verification
must not be represented as a completed release.
