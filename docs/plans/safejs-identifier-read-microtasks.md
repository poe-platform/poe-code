# Identifier read microtask sequencing

The full refreshed candidate failed run.snapshot's mid-run dump timing assertion.
The unchanged test reproduced in isolation in 121ms: dump resolved for the first
await boundary instead of waiting for the next boundary as expected.

The binding-reference implementation introduced unconditional awaits around
lexical scope resolution and reference reads. Both operations can complete
synchronously for ordinary lexical identifiers; the earlier identifier path
read them synchronously. Restore that path while retaining evaluateNode's
replay bookkeeping, budget/exception handling and the single-reference observer.
Object-environment reads still await asynchronous resolution and getters.

The existing checkpoint test is the red regression. Verify it without changing
its microtask flush count, then check historical Promise replay, with/accessor
semantics, TypeScript and lint. The focused repair is applied to both the main
tree and the now-completed validation candidate; later main followups remain
outside that candidate until explicitly synchronized.

Validation after the repair:
- The unchanged isolated mid-run dump test passes in the candidate (170ms).
- Main-tree Promise compatibility/aliases and dynamic-with runtime and snapshot
  checks pass: 82 tests across five files.
- TypeScript passes. The complete run.snapshot and run.failure-replay suites
  pass; the three-file selection including adjudication reports 66 passed and
  one failure: the unchanged co scenario exceeds its five-second deadline.
- Historical PPR2, trusted Promise replay and pending Promise continuations
  pass all 61 tests across three files.
- Focused interpreter and array-context-test lint passes. Isolated co
  adjudication still exceeds its unchanged five-second timeout. A standalone
  stage probe reaches the pending boundary in 492ms, completes the original
  in 549ms and completes one resumed public checkpoint in 1023ms total.
  This rules out a deterministic stall on that path, not on every capture.
  These focused passes do not establish a green complete workspace gate.

A subsequent full stage probe completed public, signal and completed captures,
all three restores, recaptures and final executions successfully in 2662ms.
The public/signal/completed paths finished at 1349/1992/2662ms respectively.
The probe is diagnostic only; it does not replace the unchanged test's native
trace, host-call and snapshot-immutability assertions.

With the other checks finished, the unchanged isolated co test still fails:
5390ms test duration against 5000ms. Therefore the failure cannot be dismissed
as just concurrent validation load. Next isolate stage costs inside the exact
assertion-bearing test; retain all fixtures, assertions and deadlines.

Temporary stage instrumentation of that exact test passed in 3690ms and
4101ms, with unchanged assertions and timeout. In the logged 4101ms run:
native checks finished at 3ms, original execution/captures at 942ms, and the
three restore/recapture/final-execution groups at 2172/3131/4101ms. Resume
assertions took only 1–2ms per group. This does not support weakening or
rewriting assertions. The temporary instrumentation was removed and a clean
diff confirmed the original test was restored before its final rerun.

The final uninstrumented isolated co test passed in 4250ms (18 unrelated
cases skipped). Retain the earlier failures as unresolved performance evidence;
one focused pass does not establish headroom or whole-suite reliability.
