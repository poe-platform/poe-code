# Fix Ralph selection test timestamps

## Scope and cause

- Change only `src/cli/commands/experiment-ralph.test.ts` and this plan.
- Parent reports release run `32991576445` failed because the frontmatter-hints
  test expected plan A at `options[0]` but received plan B.
- Independent confirmer Pasteur established that equal 1000 ms timestamps yield
  A, B; timestamps 1000/1001 ms yield B, A; explicitly equalizing them restores A, B.
- Both plans have draft readiness. Production correctly orders newer modification
  times first, then filename for ties; memfs fixture creation can cross a millisecond.

## Plan

1. Freeze only `Date` at 1000 ms before creating the original fixture. Advance it
   to 1001 ms and rewrite plan B in memfs. Verify both modification times and run
   the original positional assertions unchanged to demonstrate deterministic red.
2. Remove the temporary skew and timestamp assertions. Keep only
   `vi.useFakeTimers({ toFake: ["Date"], now: 0 })` before fixture creation.
   The existing describe-level `afterEach` restores real timers.
3. Run the focused test, related tests, targeted lint, and scoped whitespace checks.

Preserve all existing assertions and production semantics. No production changes,
new dependencies, real fixture files, network/LLM calls, commits, or pushes.
The prior plan-discovery timestamp fix is out of scope and remains untouched.
This test-only fixture fix has no CLI visual impact requiring screenshots.

## Evidence

- Deterministic red:
  `node_modules/.bin/vitest run src/cli/commands/experiment-ralph.test.ts -t 'shows frontmatter hints in the doc selection prompt'`
  failed: 1 failed, 121 skipped, 2.49 s total. The temporary assertions confirmed
  plan A at 1000 ms and plan B at 1001 ms. The original `options[0].label` assertion
  then expected `docs/plans/plan-a.md` but received `docs/plans/plan-b.md`, matching
  the reported release failure. All temporary skew setup and timestamp assertions
  are removed; the final test change is only the Date-freezing line.
- Focused green: the same focused command passed with the final Date-only freeze:
  1 passed, 121 skipped, 2.19 s total.
- Related green:
  `node_modules/.bin/vitest run src/cli/commands/experiment-ralph.test.ts packages/agent-harness-tools/src/plans.test.ts packages/agent-harness-tools/src/plan-readiness.test.ts`
  passed all 139 tests across 3 files, with no skips, in 2.16 s. This includes all
  122 experiment/Ralph CLI tests and the existing readiness/mtime ordering coverage.
- Target lint:
  `node_modules/.bin/eslint src/cli/commands/experiment-ralph.test.ts`
  passed without diagnostics.
- Scoped whitespace:
  `git diff --check -- src/cli/commands/experiment-ralph.test.ts docs/plans/bugfix-ralph-selection-test-timestamps.md`
  passed without diagnostics.
