# Runtime stop grace timer

## Independently confirmed behavior

`waitForGracefulStop` races job exit, the grace timeout, and SIGTERM failure, but
never clears a losing timeout. A successful public stop can print its success
message and persist killed state in milliseconds while its referenced 30-second
timer keeps the CLI alive. The parent captured and inspected
`screenshots/ux-runtime-stop-timer-before.png`; independent probes confirmed the
timer remains active after the helper returns.

Failure paths also need timer cleanup, but bootstrap explicitly exits on errors;
this plan does not claim a user-visible error-path stall.

## Scope and implementation

- Modify only runtime jobs `shared.ts`, `shared.test.ts`, the public regression
  in `src/cli/commands/runtime.test.ts`, and this plan.
- Own the grace timeout handle locally and clear it in finally; do not merely unref it.
- Preserve concurrent wait/SIGTERM handling, escalation at grace expiry even if
  SIGTERM stalls, exact propagated errors, and tolerated post-SIGKILL wait rejection.
- Remove the private sleep helper only if no callers remain.
- Preserve dry-run behavior: no attach, no signal, no mutation, and no grace timer.
- Add no dependencies, README edits, inline comments, or unrelated changes.

## TDD and validation

1. Reproduce red with fake-timer helper tests and a registered public-command
   test using the existing in-memory runtime fixture.
2. Cover successful exit, wait/SIGTERM rejection, grace expiry, stalled SIGTERM,
   SIGKILL rejection, and post-kill wait rejection without real subprocesses or waits.
3. Apply the local timer cleanup and run focused helper/public-command tests,
   then full shared/runtime tests, scoped ESLint, root types, and diff checks.

The parent owns the separate commit/push and after-change public CLI QA. Test
flows use memory mocks and virtual time, not real signal delivery or a 30-second wait.

## Validation results

- Red: five cases retained one timer instead of zero: normal exit, exit while
  SIGTERM stalls, wait rejection, SIGTERM rejection, and successful public stop.
  Five escalation/error/dry-run controls passed; 70 unrelated tests were skipped.
- Focused green: all 10 new cases passed after the local finally cleanup.
- Full shared/runtime suites: all 80 tests passed (22 shared, 58 runtime), with
  76 ms combined test execution and 2.14 seconds total runtime.
- Scoped ESLint, root `npm run lint:types`, and scoped `git diff --check` passed.
- Removed only the now-unused private sleep helper. No unref workaround,
  error-policy changes, or changes to signal delivery/escalation were introduced.
- The parent was notified when focused tests turned green; after-change public
  CLI QA and the separate commit/push remain with the parent.

## Parent QA

- Four actual registered-command cases with memfs and an inert runtime factory
  passed: successful stop, dry-run, wait rejection, and SIGTERM rejection.
- Successful stop retains its success output and killed state. Dry-run does not
  attach or create a timer. Rejections preserve the original error and job bytes.
- Every non-dry-run case creates and clears its default 30,000 ms timer; none
  leaves a referenced timer after returning. No real sandbox or process is killed.
- Captured and inspected `screenshots/ux-runtime-stop-timer-after.png` against
  the before screenshot. A separate bounded real-process helper probe with an
  800 ms grace period returned immediately both times; process lifetime fell
  from 1.24 seconds before to 0.36 seconds after. This is ad hoc validation, not
  a timing-sensitive unit test.
