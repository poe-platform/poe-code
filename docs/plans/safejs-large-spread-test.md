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
