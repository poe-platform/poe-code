# Preserve enrolled output-write completion through shell wrappers

The independent pr review reproduced five actual-Shell failures for enrolled
stdout writes: after caller cancellation with `false`, `0`, empty string or
`null`, or shell disposal, execution settled while the admitted owned write was
still pending. Evidence is retained in
`/tmp/issue680-pr-independent-red-v6.log`. This is a shared wrapper defect, not
a reason to weaken pr lifecycle tests or change ordinary opaque sink semantics.

`Budget.sink` and `signalSink` currently wrap the enrolled `ownedOutput.write`
promise in `interruptible`. That hides its real completion from the command's
registered cleanup. Preserve the actual completion promise for enrolled writes
while retaining admission checks, shared output charging, borrowed cancellation
and ordinary interruptible `write`. Do not enroll opaque writes automatically.

Add generic test-first actual-Shell regressions without a pr dependency. Exercise
falsey cancellation, disposal, consumer closure, write rejection and successful
completion. Keep opaque writes interruptible. Independently review and run the
existing output/cancellation tests, full maintained validation and packed checks
required by the shared change. Root owns the separate atomic commit and release.

The frozen shared fix passes 91 adjacent tests, including 36 generic regressions,
and strict scoped types. It also preserves getter admission, write receiver and
budget reentrancy checks. Initial 10/32 failures, getter 2/34 failures and
reentrant-budget 1/36 failure remain in `/tmp/issue680-owned-output-*-red-v1.log`.
The final focused log is `/tmp/issue680-owned-output-adjacent-v3.log`.
Final repository/build/packed qualification is still required before pushing.
