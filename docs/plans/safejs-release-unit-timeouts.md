# Fresh unit-check release failures

## Evidence

CLI release run 34069004089 for c4a7707f6 failed in fresh unit checks. The scoped
package release independently published SafeJS 0.1.292 successfully.

The failed job reports two five-second test timeouts:

- packages/safe-js/src/interp/float32-camera.test.ts: inverse-coordinate-transforms
  camera native-trace case.
- packages/safe-bash-playground/src/session.test.ts: accurate playground help
  in the real shell. Its afterEach also reports one worker remaining.

Do not dismiss these as pre-existing, retry blindly, raise timeouts, or reduce
asserted behavior to obtain green checks. Reproduce/profile the relevant tests
locally and inspect the cost and cleanup paths. Separate expensive integration
setup from unit assertions where justified, preserve native-trace coverage, and
guarantee cleanup even when an assertion or timeout aborts a test. Each atomic
improvement gets its own commit and push, with release monitoring continued.

The playground help test currently performs one separate session.run for each
listed shell builtin. The camera test evaluates the entire fixture source for
each case with budget accounting enabled. These are inspection findings, not
yet proof of the root cause; collect timings before changing them.

## Playground help test improvement

Local baseline: the help test took 3,008 ms and the three camera cases took
4,468/3,938/3,003 ms. The isolated runs pass but demonstrate little margin against
the unchanged five-second timeout. The help test now sends all `type -t` operands
in one shell execution and checks every output entry, exit status, stderr, and
trailing newline. No builtin assertion was removed. Its measured time fell to
250 ms. The fixture cleanup runs in finally, preserving the zero-worker assertion
while ensuring cleanup when that assertion fails.

Verification: 31 session tests and all 164 playground workspace tests pass;
scoped ESLint and the playground TypeScript check pass. This is a test-only
change with no visual CLI or production behavior change.

## Camera investigation remains open

A CPU-profiled first fixture run took 3,956 ms for 11,558 interpreter steps and
7,123 peak retained-data units. Most samples are in values/object-model retained
accounting rather than camera arithmetic. Preserve the complete fixture and
budget checks while validating a specific accounting optimization next.

## Follow-up CI evidence, 2026-09-07

CLI release run 34071655189 for species commit 7846dd0a5 failed its fresh shared
unit job on the inverse-coordinate-transforms camera case: the 5000 ms timeout
still occurs after the retained-accounting optimization. The run reported 34,146
passes, one failure and 42 skips. All Bash shards, build, audit and checks passed.
Scoped publication succeeded independently as SafeJS 0.1.296; this is not a
successful CLI release. Receipt: /tmp/poe-safejs-species-cli-release-failed.log.

Re-profile or improve the unit workload without raising its timeout, skipping
the case, weakening trace assertions or removing budget checks. The earlier
local speedup remains real, but is insufficient evidence of CI reliability.

The next isolated allocation improvement is recorded in
`safejs-float32-metadata-accounting.md`. It avoids numeric-element descriptor
allocation during metadata inspection, but its profile share is small; keep the
camera timeout investigation open after delivering that improvement.

## Recurrence after generator property delivery

CLI release 34074441829 for 3b1704e41 failed the same five-second inverse-camera
test in fresh shared units: 34,221 passes, one failure, 42 skips. Receipt:
`/tmp/poe-safejs-generator-properties-cli-release-failed.log`. Scoped SafeJS
0.1.299 published successfully. The preceding 74ceb0229 CLI run did pass and
published poe-code 14.0.79, so that single green run did not establish reliability.

The next investigation selected revision-tracked guest-function property storage. Unlike raw
intrinsic objects, these tables are created privately by materializeFunctionProperties;
a transparent internal mutation-tracking proxy could observe every subsequent
write, including native host writes through the exported table reference. Cache
only descriptor-derived retained lists while their table revision is unchanged;
continue visiting referenced mutable values and checking prototype changes on
every measurement. Keep raw untracked objects on the existing scan path and
preserve duplicate-root accounting rather than changing budget units. This is
the scope of `safejs-function-retention-accounting.md`. The implemented candidate
passes 87 focused tests plus lint/typechecking and the selected native ESM build.
Isolated built inverse-camera timings improved from 2,223/2,037/2,122 ms to
1,678/1,627/1,618 ms with unchanged 11,558 steps and 7,123 peak retained units.
Full qualification passed 17,444 tests with 41 declared skips and the two
explicit unresolved-file exclusions. The actual harness and viewed screenshot
also passed after 70 uncached root build tasks. Keep the CI
timeout open until publication evidence supports reliability; local timing alone
does not establish that.
