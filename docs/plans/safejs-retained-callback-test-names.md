# Retained callback test identities

The disposal/scheduling qualification failed seven retained-callback cases, but
Vitest object-placeholder formatting truncated the second-amount value in their
workflow names. A focused selector for `second amount: 2` ran zero tests. The
JSON report has 21 tests and only 13 unique full names (210556), with duplicate
names for different counter workflows. Report:
`/tmp/safejs-retained-callback-name-before.json`.

In the isolated scheduling/disposal candidate, change only describe.each's input
to name/workflow tuples and its format to `%s`. This follows the separately
qualified camera-name correction. Preserve all workflow sources, assertions,
checkpoint repetitions, budgets and timeouts. This is a test-reporting repair,
not a runtime or timing repair; keep its eventual atomic commit separate.

The exact second-amount selector, narrowed to uninterrupted delivery, is running
as session 15368. Collect its terminal JSON result rather than treating this
plan as evidence of a passing selection. Main remains frozen for package gate
64545.

The naming-only selection completed successfully (8a0ccc). JSON inspection
confirms all 21 full names are unique and exactly the two intended uninterrupted
second-amount-2 cases ran (a86a7c): 260.15ms with the input Promise and 92.38ms
without. The other 19 cases were intentionally skipped; do not count them as
passes. Report `/tmp/safejs-retained-callback-name-after.json`.

Scoped lint, main integration after its live gate, and the remaining checkpoint
timing investigation are still required. No timeout, runtime budget or workflow
coverage changed in this isolated naming repair.

## Main qualification

After the main package gate terminated, ported only the tuple/name correction.
All 21 retained-callback tests passed (23282c), with 12.82 seconds in tests.
The JSON report `/tmp/safejs-retained-callback-main-names.json` contains exactly
21 unique full names and no failures (b60fd1). Scoped ESLint passed (0144c2),
and git diff --check passed. This independently qualifies the naming change;
the disposal runtime remains isolated. Commit only this test and plan locally.
No push or release while publication is on hold.
