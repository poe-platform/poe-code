# Preserved first-run harness defects and bounded follow-up

The first candidate run used `candidate.mjs` from commit `a035cb1f`, after
pre-execution inspection commit `d1bf8f00`. Its immutable `isolated-01/capture.json`
records 30 valid result spans, 13/13 frozen expectations, 14/17 harness controls,
and 137/137 unchanged scoped tests. Three harness rows failed: pattern-byte cap,
subject-byte cap, and pre-aborted reason identity. They are not silently changed.

All three APIs throw synchronously. The driver evaluated `matchExpr(...)` before
calling `assert.rejects`, so the assertion never inspected the exact errors.
The shared protocol source cap still throws `ExprMatchError('limit', ...)`, and
the pre-aborted reason escapes unchanged; no product failure or fix follows.
The maintained driver now wraps the call in an async function, accepting either
synchronous throw or rejection while retaining the same identity assertions.

Only those three assertions will be rerun, explicitly using `assert.throws`.
Four post-inspection resource controls are also frozen here before execution:

1. P/aaa exact returned `steps` admits the same result; one fewer step rejects
   with the work-limit category and message, not a partially successful result.
2. Binary search `maxStates` in the unchanged `[1,65536]` policy finds the first
   admitted P/aaa state cap. The boundary accepts; boundary minus one rejects
   with the states-limit category/message. Record every bounded probe.
3. The same boundary search for `maxAllocatedUnits` in `[1,4000000]` verifies
   the allocation error category/message. Record every bounded probe.
4. At one reused worker session, nested nullable/backreference input lengths
   4, 8 and 12 must return validated spans or typed budget errors under explicit
   steps 20000, states 1000, allocation 30000. No capture-history expectation,
   asymptotic complexity claim, or normative pass is inferred from these rows.

These are post-inspection controls, not additions to the pre-inspection 28-case
semantic denominator. First-run source/compiled snapshots stay unchanged; the
follow-up writes a new output file and never re-executes the 137 scoped tests.
