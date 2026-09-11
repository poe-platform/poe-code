# Temporal Duration rounding

Validated the missing method with 28 tests: 24 failed and four TypeError
controls passed incidentally before implementation (21ee6d). The initial method
then passed all 28 (2bdf7c). Broader Duration qualification passed 288 cases in
sixteen files (2acdfa), including host copy and snapshot/replay.

The [rounding algorithm](https://tc39.es/proposal-temporal/#sec-temporal.duration.prototype.round)
reads largestUnit, relativeTo, roundingIncrement, roundingMode and smallestUnit
in order. The adapter evaluates guest getters and primitive conversion inside
the interpreter, validates independent options at their read point, and uses
the shared relativeTo reader. Only normalized values enter backend rounding.
The result is copied into owned private Duration fields with the captured
original-realm prototype, a data checkpoint and intrinsic method registration.

Tests cover all nine rounding modes with positive/negative halfway values,
unit strings, balancing, increments, invalid/cross-option constraints, calendar
months, DST days, order without enumeration, private branding, replaced public
constructors/getters, metadata and captured-method completed-host-call replay.

Read-only backend probe 9cbe65 correctly distinguished one nanosecond below,
at and above a 365-day-year midpoint for halfExpand. This potential precision
problem was not reproduced, so no speculative rounding repair was applied.
Full backend/Temporal conformance is not established by that probe.

Maintained selected-workspace build 14b990 passed 23 tasks and five fresh-process
ESM imports. Scoped lint 95b548 passed. The feature remains uncommitted with
the Temporal foundation, and the full-package gate remains unproven.
No push or release.

Built guest/native Node 26.4.0 comparison 7b5b7f covered 432 combinations of
nine modes, four units, four durations and three relative contexts. Of these,
430 matched exactly. The two differences were halfCeil/halfExpand one nanosecond
below the positive 365-day-year midpoint: guest correctly returned PT0S while
native returned P1Y. Added explicit below/at/above midpoint assertions for both
modes; the final focused file passed all 30 tests (b7ea4a), with lint 1938de.
Do not change correct guest results merely to agree with this native discrepancy.

Node 18.18.2 CLI 9b23a8 passed the default tie, negative floor, calendar month
and DST-day examples. Screenshot a284c9 was reviewed. The staged safe-bash
patch fingerprint remains unchanged (2545a9).

## Adapter reconciliation after the total-boundary fix

The preceding observations are historical. The current adapter still delegates
normalized rounding to the backend, with owned result allocation; no runtime
change was warranted by this audit.

A fresh same-process comparison against native Node 26.8.1 checked zero-duration
rounding at both PlainDate limits (-271821-04-19 and +275760-09-13), for year,
month, week, day, hour and nanosecond precision. All twelve cases returned PT0S
in both implementations (cf3f10). Unlike the repaired total adapter, rounding
already handles these boundaries correctly. Added twelve parameterized regression
cases covering these results plus fresh-result identity and Duration branding.

Commit the adapter and focused tests locally. The public Duration constructor
and Temporal namespace wiring remain uncommitted, as does snapshot integration.
These working-tree checks do not establish standalone HEAD conformance or a
green full-package gate. Skipped-day rounding remains subject to the unresolved
specification issue documented in safejs-skipped-day-calendar-totals.md.

The first concurrent qualification attempts failed: the focused Node 22 cohort
had 55 passes and two timeouts in existing option tests (6355a0); Node 18 had
31 passes and one timeout in the initially batched boundary test (942476).
The machine reported load averages 69.93/60.52/54.89 with other work running
(9d2706). This is evidence of contention, not proof of a repaired timeout.
Separated the twelve new boundary/unit cases so each is independently timed
and reported, preserving every assertion and the existing 5000 ms deadline.
Recheck the focused file before considering the adapter qualified.

The final focused file passed all 42 tests on Node 22 (e9f16a) and Node 18.20.8
(529fc7), with the unchanged timeout. Package type-checking passed (af3a9a),
and adapter lint passed (612bff). These results qualify the current focused
behavior; they do not establish that full-suite timeout problems are fixed.
Final test-file lint passed (3edd07). No push or release occurred.
