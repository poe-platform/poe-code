# Pre-execution guard clarification

The initial ten-guard draft remains in commit 488cc23. It has not been executed.
Its pending-source-abort fixture supplied no abort cooperation, yet expected
prompt settlement. That assumption conflicts with the project rule that host
work cannot be forcibly cancelled, and with the author's frozen plan at
960f3b9 (read before author handoff and before any guard execution).

The corrected fixture explicitly observes the supplied AbortSignal and rejects
its own pending read. The expected abort reason and cleanup checks are unchanged.
Two distinct additional guards now record the uncooperative-source limitation:
Worker cleanup must finish promptly, but iterator.next remains owned until the
source settles; queued consumer return must not overlap that pending next.
Controlled stalls are explicitly released, with late rejection observed.

This is a disclosed pre-execution fixture correction, not a rewritten passing
expectation or discarded failure. All sixteen original cohort assertions and
the two actual baseline failures are untouched. Final guard denominator: twelve.
Every guard is benign; no pathological probe is scheduled.
