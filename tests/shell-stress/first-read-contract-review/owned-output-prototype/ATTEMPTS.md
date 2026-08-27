# Focused attempts

## Baseline replay

Reconstructed the accepted c9 dirty-source candidate in unique owned `/tmp`.
Unchanged original5: five 1200ms failures; head-zero: pass. Other controls:
19 remote + 28 byte IO + 5 shared lifecycle + 4 streaming = 56, together with
head-zero = 57. Nine initial review-control executions failed before test logic
because the copied harness retained a relative `.scratch/candidate/dist` import.
Correcting only that harness import to `candidate/dist` produced nine passes.
Both sets of raw results remain. Pinned GNU5.3 five effect cases passed.

## Initial prototype r0

Compiled source and scoped source/test typecheck passed. Adapted five: 5/5.
Unchanged originals: 1/5 (S3) passes because its original source factory already
captures the IO signal; local still times out and three other cases reject the
new non-aborted stage signal. Head-zero passes. Original fixtures not changed.

Existing controls: 54/57. Three `completed-*` remote cases require legacy
post-completion stage cancellation after successful legacy writes. Initial
prototype suppressed that finalization too broadly; this is a source regression,
not a fixture waiver. Review controls 9/9. Author cases 6/12: six failures are
strict whole-result object assertions that omitted existing stdoutBytes and
stderrBytes fields; subsequent assertions in those cases were not yet reached.

## Focused self-fix round 1 (intent unchanged)

- Restore legacy final cancellation for stages recorded as having successful
  legacy writes, while owned writes continue not to mark that legacy set.
- Preserve optional actual external sink capability through Shell capture,
  discovered during source review; no demand inference for opaque sinks.
- Share curl response disposal completion across retries/redirect stop and
  operation cleanup, found during source review, to avoid duplicate disposal.
- Correct only author expected result shape: explicitly assert exact byte
  arrays in addition to unchanged expected status/stdout/stderr. Preserve the
  initial author fixture and publish its exact separate patch/hash.

No original/control input, deadline or assertion was relaxed. Author intentions,
12 logical cases, adapted5 bindings, and API declaration remain frozen. R0 source
is preserved separately before these corrections. Results follow in REPORT.

## Evidence sealing correction (no source/test change)

The first sealing script incorrectly required exit 0 from `git diff --no-index
--check` on differing directories. The actual command returned 1 with empty
stdout/stderr. Sealing now accepts 0 or 1 only with no whitespace diagnostics.
That initial attempt stopped before chmod, closure/artifact generation or commit.
No source, test, deadline or result assertion changed in this correction.
