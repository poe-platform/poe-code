---
title: Spread result protocol
---

# Keep host-argument-limit regression fast

## Evidence

CLI release run 34024062779 failed because the million-element push-spread
regression exceeded its five-second timeout. The same focused test passes locally
in 1.53 seconds; this is a CI test-cost failure, not evidence of wrong spread output.

## Improvement

Use 600,000 elements and assert that applying native Array.prototype.push to the
same arguments throws RangeError. This proves the fixture still crosses the actual
host argument limit instead of relying on an unexplained large number. Verify the
sandbox result length and first/last values. Keep the existing timeout unchanged.
For built-in spread iterator results, read done/value synchronously instead of
allocating and awaiting two extra promises per element. Guest result accessors
still use the guest-aware asynchronous reader, and value is read only if done is
false. Pending prototype/toStringTag work is excluded from this fix.

A 250,000-element trial overflowed the main Node thread but did not overflow the
Vitest worker. The explicit native assertion caught that insufficient fixture;
the regression must cover the worker's actual limit as well.

## Verification

Run the focused regression, maintained SafeJS package unit suite, and file-scoped
ESLint before committing and pushing this atomic test improvement to main.
Monitor the resulting release workflows independently of continued language work.

The final maintained suite passed 13,926 tests (41 skipped); 523 focused
interpreter/iterator controls and two added spread-result getter/promise controls
passed separately. TypeScript and file-scoped ESLint exited zero. The smaller
fixture's native-overflow assertion passes in the Vitest worker. This does not
yet prove CI timing; the next CLI release must confirm that independently.

Logs: /tmp/poe-safejs-large-spread-package-final.log,
/tmp/poe-safejs-large-spread-focused.log,
/tmp/poe-safejs-large-spread-eslint.log and
/tmp/poe-safejs-large-spread-types.log.

The selected workspace build passed (23 builds and four fresh-import checks).
The real harness screenshot was inspected: Harness passed, zero spawns, readable
result summary. Evidence: /tmp/poe-safejs-large-spread-build.log and
/tmp/poe-safejs-large-spread-screenshot.log.

## September 9 CI follow-up

Release run 34312551079 timed out in the same regression with 600,000 elements.
The earlier fixture reduction was insufficient under that runner's load. Preserve
the evidence above as the historical result; the current test uses a different
worker configuration to reduce its cost without losing the native-overflow check.

Bundle the current interpreter source in memory with esbuild (`write: false`) and
execute it in a dedicated Worker with a 1 MiB native stack. In that same worker,
assert that native push rejects 150,000 arguments with RangeError, then verify that
SafeJS accepts the same array and returns its length and first/last values. A plain
150,000-element fixture in Vitest's larger default worker did not overflow, so it
was rejected. Loading TypeScript inside the dedicated worker also cost too much;
the in-memory bundle avoids that startup work without relying on existing dist.

Keep the five-second timeout and production runtime unchanged. Terminate the
worker after success, failure, or timeout, and reject errors or premature exits.
Check the test's abort signal after bundling and before worker construction, so
a bundle that finishes after timeout cannot acquire a worker after cleanup.
The focused bundled-worker test took 734 ms locally, including bundle and startup,
versus 1,640 ms for the original fixture. These local timings do not establish CI
timing; the repaired release must verify that separately.

The maintained SafeJS suite passed 21,651 tests (37 skipped) across 733 passing
files before the final signal guard. A bounded timeout control used an actual
Worker: delayed bundling caused one late launch without the guard and zero with
it. Its two timeout failures were intentional controls, not passing tests.
All 477 interpreter tests passed after the signal guard; the regression took
509 ms including bundling and worker startup.

For this follow-up, rerun the interpreter file after the signal guard and use the
maintained guarded root lint command after tests finish. Do not reuse the earlier
file-scoped ESLint route or run source-writing test fixtures alongside that guard.
