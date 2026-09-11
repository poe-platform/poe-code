# String padding argument conversion

## Validation

Minimal native/guest comparisons showed both padStart and padEnd failing with
guest filler objects, whether padding was required or not (38e27f). The
unchanged runtime then failed 26 of 30 regression cases (f7a038). Guest target
and filler hooks were bypassed, thrown values were lost, and callable inputs
or ignored extra arguments were rejected.

## Repair

Both methods convert target length through sandboxNumber after the receiver.
NaN and truncated lengths no greater than the receiver length return without
converting the filler. Otherwise the filler uses sandboxString unless undefined,
which preserves native default spacing. Native padding performs final length
clamping, filler repetition/truncation and empty-filler handling. Primitive-only
direct calls stay synchronous. Receiver, arguments and converted filler remain
retained during guest conversion; output allocation remains budgeted.

Removed the now-unused native number/string conversion helpers after migrating
their final callers. No unrelated string behavior was deliberately changed.

## Verification

The initial regression and existing string-method suite passed 52 tests
(368115). Expanded cases check truncation before the no-padding return,
pending/completed checkpoints and direct-context-free calls with output budgets.
The final four-file selection passed 73 tests, including all 36 padding
regressions (3dda24). Targeted ESLint and the maintained package TypeScript
configuration passed (7ad30e).
No CLI visual changes, push or release. The prior full-package result predates
this repair and its 14 remaining failures are unresolved.
