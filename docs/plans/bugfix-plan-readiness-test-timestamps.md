# Fix plan readiness test timestamps

## Scope and cause

- Change only `packages/agent-harness-tools/src/plans.test.ts` and this plan.
- The reported release failure is run `32991050798`; the parent owns its rerun.
- The readiness test assumes `Volume.fromJSON` assigns equal modification times.
  The independent confirmer reported 10 failures in 200 memfs trials.
- `discoverPlans` correctly sorts by readiness, then modification time descending,
  then display path. A one-millisecond newer explicit draft precedes the other
  draft, contradicting the test's implicit equal-timestamp assumption.

## Implementation and validation plan

1. Reproduce the failure with the original test name and assertion unchanged:
   use the existing memfs `rawFs.utimes` to set the first two fixture timestamps
   to 1 second. Temporarily fake only `Date` at 1001 ms while rewriting the explicit
   draft in memfs, verify its modification time is 1001 ms, and restore real timers
   in `finally`. This memfs version truncates fractional seconds passed to `utimes`.
2. Set all three timestamps explicitly to 1 second and rename the test to describe
   filename ordering when modification times tie. Preserve the assertion exactly;
   do not sort the actual result or change production behavior.
3. Run the focused test and the agent-harness-tools package suite without real
   fixture files, then check the scoped diff for whitespace errors. Report any
   existing tests incompatible with that restriction rather than changing them.

All fixture operations stay in memfs. No new dependencies, real fixture files,
network or LLM calls, comments, README edits, commits, or pushes are needed.
There is no CLI visual change requiring screenshot validation.

## Evidence

- Deterministic red:
  `node_modules/.bin/vitest run packages/agent-harness-tools/src/plans.test.ts -t 'sorts ready plans before drafts while preserving source order'`
  failed at the original unchanged ordering assertion: 1 failed, 14 skipped,
  302 ms total. Actual IDs were `ready, explicit-draft, draft`; expected IDs were
  `ready, draft, explicit-draft`. The temporary 1001 ms timestamp assertion passed.
  The initial fractional-`utimes` attempt passed because both times became 1000 ms;
  the bounded clock reproduction above establishes the actual one-millisecond gap.
  All temporary clock control, rewriting, and timestamp assertions are removed
  from the final patch.
- Focused green:
  `node_modules/.bin/vitest run packages/agent-harness-tools/src/plans.test.ts -t 'sorts ready plans before drafts with filename ordering when modification times tie'`
  passed: 1 passed, 14 skipped, 366 ms total.
- Complete changed test file:
  `node_modules/.bin/vitest run packages/agent-harness-tools/src/plans.test.ts`
  passed all 15 tests, 896 ms total, including the existing newest-mtime ordering
  test. Assertions and production sorting remain unchanged.
- Package validation used the existing workspace test command with a name filter:
  `npm run test:unit --workspace @poe-code/agent-harness-tools -- -t '^(?!.*(?:creates a default runner log directory inside the poe-code state directory|rejects a symlinked logs ancestor outside the poe-code state directory|rejects a symlinked runner ancestor outside the poe-code state directory|terminates the full wrapped host command process group on inactivity timeout)).*$'`
  passed 236 tests across all 16 test files, with 4 excluded tests, 3.11 s total.
- Full unfiltered package green is not established: the three named run-log tests
  create real temporary directories/symlinks, and the named host-process test
  requires real temporary files shared with a shell process. They were excluded
  only at invocation time to honor the no-real-files constraint; their source and
  assertions are untouched. Running the unfiltered command requires permission
  for those existing filesystem-backed tests.
- Target lint:
  `node_modules/.bin/eslint packages/agent-harness-tools/src/plans.test.ts`
  passed without diagnostics.
- Scoped whitespace:
  `git diff --check -- packages/agent-harness-tools/src/plans.test.ts docs/plans/bugfix-plan-readiness-test-timestamps.md`
  passed without diagnostics.
