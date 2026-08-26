# Task created-order chronology

## Scope and contract

Change only the shared comparator, its unit tests, this plan, and backend conformance tests.
Sort nonempty parseable creation strings by numeric timestamp, ascending. Equal instants
retain incoming priority. Invalid nonempty strings form a separate category after valid
timestamps and before missing values, ordered lexically with stable equal-string ties.
Missing, empty, and nonstring values remain last, ordered by qualified ID.
Do not reject existing malformed creation values or change default/alphabetical order.
The GitHub backend also uses the shared comparator.

## TDD sequence

1. Add fast comparator regressions and 20 public `openTaskList` conformance cases across
   YAML and strict Markdown using raw persisted memfs fixtures, not `create()`.
2. Confirm failures for offsets, fractional precision, equivalent instants, and invalid
   categories before changing production code. Check all comparator category pairs to
   guard against nontransitive lexical fallback.
3. Apply minimal numeric timestamp comparison with explicit invalid categorization.
4. Run focused tests, the task-list package suite, targeted lint, and type checking.
   Fixtures must remain unchanged; tests use no real files or network.

## Validation

- Red: `node_modules/.bin/vitest run packages/task-list/src/backends/utils.test.ts packages/task-list/src/backends/conformance.test.ts -t 'created order'`
  failed before the comparator patch: 22 failed (6 unit, 16 public conformance), 5 passed,
  70 skipped; 414 ms total.
- Green: the same focused command passed all 27 regressions, with 70 unrelated tests
  skipped; 392 ms total.
- Package: `npm run test:unit --workspace @poe-code/task-list` passed all 344 tests in
  18 files, including GitHub backend coverage; 1.64 s total.
- Target lint: `node_modules/.bin/eslint packages/task-list/src/backends/utils.ts packages/task-list/src/backends/utils.test.ts packages/task-list/src/backends/conformance.test.ts`
  passed without diagnostics.
- Package types: `node_modules/.bin/tsc -p packages/task-list/tsconfig.json --noEmit`
  passed without diagnostics.
- Whitespace: `git diff --check` passed.
- All 20 raw-fixture cases check default, explicit priority, alphabetical, and created
  ordering, and verify the persisted memfs contents remain unchanged.

Parent owns CLI screenshot QA, commits, pushes, and release monitoring.
