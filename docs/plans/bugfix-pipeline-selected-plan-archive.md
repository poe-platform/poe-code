# Archive the selected pipeline plan

## User-facing failure

An explicit Markdown plan can live outside the configured discovery directory.
Execution correctly uses that file, but successful finalization looks up its
basename-derived identity in the discovery directory. This either archives an
unrelated open plan with the same identity or fails after the selected work is
already done. The selected plan stays active in both cases.

## Required behavior

- Archive the successfully completed selected plan beside that plan, regardless
  of the directory used for discovery.
- Resolve absolute, relative, normalized parent-segment, and home-relative plan
  paths consistently for execution and finalization.
- Preserve the existing number-prefix identity convention and archive naming.
- Do not change other active plans, renumber siblings, or overwrite an existing
  archive destination.
- Preserve explicit archive disabling, already-complete no-op behavior, failed
  task/teardown behavior, and run-limit stopping behavior.

## Implementation

Continue to use the shared archive helper and its existing task-list state
transition. Pass the selected absolute plan's containing directory rather than
the configured discovery directory. Keep discovery configuration solely for
discovery. Remove the now-unused finalization-local configuration binding.

This does not change finalization retry semantics, introduce a new archive
format, or broaden the archive backend's existing file-format support.

## Verification

Nineteen public SDK tests use memfs and injected successful/failing runners. The
old implementation has thirteen causal failures and six passing controls. Cover
six explicit-path forms both with and without a matching unrelated discovery
plan, configured discovery, disabled archiving, already-completed plans, failed
tasks and teardown, unfinished run limits, and an existing archive destination.
Assert unrelated plan bytes remain unchanged and selected completion preserves
its tasks and body.

Run the focused Pipeline/SDK/archive-helper suites, maintained build, and normal
commit/push hooks. Verify the released public SDK on Node 18/20/22/24 using the
actual registry artifact, not source aliases or an instrumented substitute.
