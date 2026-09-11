# Shared intrinsic retention records

## Validated issue

After Locale delivery 87ebcce5e, the complete first camera fixture passed four
built-runtime runs with CPU 1515/1369/1305/1324 ms. The latest prior CLI release
34211319323 failed two camera tests at the unchanged 5000 ms limit. Neither these
local passes nor previous CPU improvements prove CI reliability.

Fresh profile directory:
`/var/folders/rw/s4cy76hn6v55qrp0dhcbtplc0000gn/T/safejs-camera-current.eTNMUyoAGY`.
The measurement visitor dominates sampled self time; intrinsic retention
callbacks and Budget.retainedValues also remain visible costs.

A built probe adds the same configurable string property probe="x" to one
function at a time, then measures the delta from Budget.retainedValues:

- Intl.getCanonicalLocales: 12 units.
- Intl.Locale: 18 units.
- Math.abs: 12 units.

Each property should contribute its five-character key and one-character value
once to this retained-root path, regardless of overlapping registrations.
trackIntrinsicState currently captures independent records when a function is
registered directly, through its namespace, and through its prototype constructor.

## TDD evidence

New intrinsic-shared-retention.test.ts run 44901 finished with three failures and
one pass. Both registration orders emit duplicate probe/x roots. A namespace
registered after a mutation initially exempts that mutation in its own baseline,
but later changes become double-counted. Two distinct functions with equal
primitive property values correctly require separate charges; that control passes.
No runtime fix has been made, and no performance improvement is claimed.

## Implementation constraints

Share tracking records by target identity within each Budget, preserving the
initial baseline. Avoid merely deduplicating equal strings or globally memoizing
mutable values. Preserve existing per-owner intrinsic immutability checks used
for snapshots and the capture-before-retained-callback semantics of each group.
Repeated registration of the same root must not overwrite its retained values
with an empty group or reset its initial baseline. Release all tracking at realm
close. Nested mutable values still need remeasurement.

Use the existing intrinsic retention/allocation, capture, prototype and data-budget
tests alongside the new regressions. Retain an optimization only after a fresh
maintained build and interleaved complete-fixture CPU measurements, without
changing fixture coverage, timeout or Budget limits. Then run broad SafeJS and
downstream validation, commit and push this atomic fix separately.

Locale scoped release 34213392316 is queued and CLI release 34213392646 is active
at the latest check; continue monitoring while implementing this fix. Collator
preparation is in its separate plan; it does not replace this validated issue.

## Local implementation and checks

The candidate shares retention ownership by target identity within each Budget.
Groups keep their first-owned records across repeated registration; separate
owner immutability checks retain their existing capture behavior. Empty duplicate
groups do not install extra callbacks. Realm release removes the new tracking.

Initial focused run 89459 passed 23 tests. Wider run 9186 found nine failures:
the shared Iterator prototype is registered before its built-in methods are
finished, so preserving its early baseline charged 97 units of trusted additions.
An explicit completeIntrinsicObjectInitialization call at the end of Iterator
installation refreshes only that trusted baseline. Ordinary re-registration still
preserves earlier guest mutation charges. No test limits or expectations changed.
Corrected run 11906 passed all 85 tests in eight accounting files. Added built-in
controls, repeated-root and cross-Budget controls; run 87636 passed all nine new
tests. Build 60343 passed 23 builds and four fresh imports; lint 90628 passed.

Built Node 18 probe verifies zero initial retained usage and six-unit additions
for Intl.Locale, Intl.getCanonicalLocales and Math.abs. Complete first-camera
candidate run 59363 passed unchanged native and recorded-output comparisons:
CPU 1448/1346/1303/1292 ms, wall 1766/1526/1479/1466 ms. This is not an interleaved
speedup proof. Retain this as a correctness fix if regression checks pass; do not
claim it fixes camera CI or is a confirmed performance optimization.

Full run 1368 is active with source/tests frozen. Log:
`/var/folders/rw/s4cy76hn6v55qrp0dhcbtplc0000gn/T/safejs-shared-intrinsics.sv3QOPQz35`.
Only the same two earlier experimental files are excluded; the nine new tests
are included. Downstream run 48274 is active. No candidate commit or push yet.

Downstream 48274 completed successfully: 163 tests / 13 files, 22.96 s.
Locale scoped release 34213392316 completed successfully and published
@poe-platform/safe-js@0.1.447 at 2026-09-08T10:10:04.5500024Z. CLI run
34213392646 is still active. Full candidate run 1368 remains live.

Full run 1368 completed successfully: 20,332 tests passed, 37 existing skips;
686 passing files and one skipped file, 422.06 s. All three unchanged camera
cases passed (3772/3618/2587 ms). No source or test edits occurred during the run.
Together with build, lint, Node 18, focused and downstream checks, this verifies
the candidate for its own atomic commit and push. No matching open intrinsic
accounting GitHub issue was found. Remote main remained at the Locale commit
before delivery, and the user's staged patch ID remained unchanged.
