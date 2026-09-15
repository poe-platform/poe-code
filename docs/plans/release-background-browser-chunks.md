# Preserve browser chunks during background-job release

The scoped release of 65bd8ad failed while preparing artifacts: publishing the
separate browser op graph removed compression chunks still imported by the shell.

## Implementation

- Build the browser shell and op entry in one graph and publish it once.
- Keep the standalone op build configuration available to its existing consumers.
- Verify publication in memfs: op exists, stale chunks disappear, and every live
  internal import target survives, including the dynamically loaded zstd chunk.

## Validation

- The new regression failed before the fix because the shell graph omitted op.
- All 47 bundle, package preparation, and output publication tests pass.
- The root bundle orchestration inventory now expects the same combined graph;
  all nine orchestration tests pass after updating that stale expectation.
- The maintained workspace build and root type check pass.
- Actual scoped artifact preparation succeeds for all three safe packages.
  On macOS its output uses /private/tmp because /tmp is a symlink, which the
  native asset publisher deliberately rejects.

## Delivery

Commit this release correction separately, push to main with normal hooks, and
monitor both GitHub release workflows through publication. The original scoped
run failed before publication; the original root release was canceled.
