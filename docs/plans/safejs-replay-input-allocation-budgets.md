# Replay input allocation limits

## Current-main defect

The Promise-property candidate's eight import/replay budget tests found two
failures (ac2677). Initial imports reject strings of length 129 under limit 128
and arrays of length 65 under limit 64, but completed replay accepts both.
At-limit controls pass. A separate regression importing current main directly
from an isolated test file reproduces both failures with ordinary object inputs
(ce2dd3). This is independent of the Promise-property feature.

The current-main reproducer is
`/tmp/safejs-new-promise-capability.KGfWqD/packages/safe-js/src/interp/current-main-replay-input-budgets.test.ts`.
It intentionally imports the main source by absolute path while main's full
package gate remains fixed. A portable candidate regression is
`src/run.replay-input-allocation-budgets.test.ts` in that isolated checkout.

## Isolated repair

The replay decoder currently returns decoded strings directly and restores
array descriptors without validating the final array length against its active
compilation owner's budget. Two checks now validate strings as they decode and
array lengths after descriptor reconstruction, before exposure. This uses the
existing budget operations and decoder rollback behavior. No extra recursive
whole-graph traversal, raised limits, or changed timeouts are introduced.

All 38 tests in the Promise budget/property and replay-input selection pass
with the isolated repair (8cc71b). The portable ordinary-input regressions and
existing replay-data cases are running together next. Main's runtime remains
unchanged while full package session 41633 runs. Once that gate is terminal,
this shared repair requires its own atomic main regression/qualification and
commit, separately from pending-Promise and property-capability features.
No delivery or release claim follows from the candidate's focused pass.

The six-file selection passed all 54 tests (3ba0d0), including ordinary-input
replay controls, Promise-property import/replay controls, existing replay-data
and replay-input tests, property graph rollback and pending proof budgets.
Scoped lint followed by TypeScript is session 12469 (efa892). The main full
package gate still runs against its unchanged source; its eventual result will
not cover this isolated repair.

Scoped lint/TypeScript passed (04d62a). Two further allocation-failure controls
verify that a later oversized Promise property restores earlier targets' exact
original property tables. All 19 tests in the resulting focused selection pass
(1b8fc9). The isolated full snapshot-directory suite is session 69560, JSON
`/tmp/safejs-property-and-budget-snapshot-results.json`; keep candidate runtime
and snapshot tests fixed until it completes. Scoped lint for the new rollback
tests is session 31883. No main source change is made while gate 41633 runs.

The isolated snapshot-directory suite passed all 2,294 tests across 165 files
(0f3330), report `/tmp/safejs-property-and-budget-snapshot-results.json`.
This qualifies the frozen combined candidate's snapshot selection, not all
host imports: the foreign Promise accessor compatibility regression remains
outside that selection. Main's full gate is now terminal with sixteen failures,
so the independent allocation repair can proceed to main TDD and qualification.

## Main integration

Main e305ee50c independently reproduces both over-limit cases with the portable
regression file, while both at-limit cases pass (7e1a8c). Only the two decoder
allocation checks were then applied on main; no isolated Promise-property
feature code was copied. All 50 tests in the six-file replay/budget/pending
selection pass (70538e). Scoped lint is session 68152; the maintained selected
workspace build closure is session 86721. Collect their terminal results before
claiming qualification. The previously completed full gate predates this repair.

Main scoped lint passed (5984e1). The maintained build is still session 86721.
Do not count the isolated snapshot pass as a new main snapshot-directory result.

The maintained main build closure passed all 23 builds and five fresh native
ESM import checks (e6dc00). Main's snapshot directory plus the public allocation
regressions is now being checked, with report target
`/tmp/safejs-replay-budget-main-snapshot-results.json`. Keep main runtime/test
source fixed until that run is terminal. The atomic repair remains uncommitted
pending that broader result; release hold still applies.

The main snapshot-directory and public allocation regression run is terminal:
the JSON report records success with all 2,291 tests passing and zero failures.
No SafeJS Vitest process remains live. Together with the preceding focused
regressions, scoped lint, and maintained build closure, this qualifies the
two-check repair for its own local commit. The full-package failures recorded
above remain unresolved; this result does not claim a green full package or
remote delivery. No push or release is performed during the release hold.
