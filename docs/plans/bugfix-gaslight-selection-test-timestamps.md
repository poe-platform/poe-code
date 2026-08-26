# Gaslight selection fixture timestamps

## Confirmed cause and scope

- Change only `src/cli/commands/gaslight.test.ts` and this plan.
- Release run `33021450584`, attempt 1, failed the test refusing plan autopicking
  with --yes: its original regex expects a.md before b.md, but received b.md first.
  Parent evidence is `/tmp/poe-code-incoming-completed-replay-failure.log`.
- Independent verifier Zeno confirmed equal 1000 ms timestamps yield a,b, while
  1000/1001 ms timestamps yield b,a. Production correctly sorts by readiness,
  descending modification time, then path; creating memfs files can cross a millisecond.
- Preserve the original regex, assertions, production comparator, and other tests.

## TDD plan

1. Freeze only Date at 1000 ms before the target test creates its container.
   Advance Date to 1001 ms and rewrite b.md in memfs; assert the two mtimes, then
   execute the unchanged original assertion to reproduce deterministic red.
2. Remove the temporary skew and timestamp assertions. Keep only Date frozen at
   0 before fixture construction, with explicit `onTestFinished` restoration of
   real timers even if the test fails. No enclosing timer cleanup is assumed.
3. Run all Gaslight tests, related plan-browser ordering tests, scoped ESLint,
   type checking, and scoped diff checks.

No production changes, dependencies, comments, real fixtures, LLM/network calls,
business actions, README edits, commits, or pushes. This is a test-only fixture
fix; visual QA is not applicable. The parent monitors the externally initiated
CI retry; this work does not rerun CI.

## Validation results

- Deterministic red: the focused test confirmed a.md at 1000 ms and b.md at
  1001 ms, then failed the unchanged regex with b.md before a.md, matching CI.
  One test failed and 60 were skipped; test execution took 9 ms.
- Removed all temporary skew setup and mtime assertions. The final test change
  freezes only Date before `createContainer` and restores timers with
  `onTestFinished`; original assertions and fixture construction remain intact.
- Green: all 61 Gaslight tests passed in 57 ms. Related discovery, plan ordering,
  and readiness suites passed another 34 tests: 95 total across four files.
- Scoped ESLint, `npm run lint:types`, and scoped `git diff --check` passed.
- The parent was notified immediately after tests turned green. Visual QA is
  not applicable because only test-fixture timestamps changed.
- Parent reviewed the Date-only freeze and guaranteed cleanup, with the original
  ordering assertion unchanged. Combined validation passed 1,723 design-system
  and Gaslight/loop/worktree tests across 79 files with all seven queued fixes.
