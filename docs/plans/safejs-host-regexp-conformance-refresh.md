# Refresh host RegExp conformance expectation

The still-running full package gate 14148 exposed a failure in
`interp/conformance.test.ts`: the historical test expects host RegExp bindings
to throw. A focused main rerun reproduced exactly that failure, with 71 other
tests passing (3d7677). Report:
`/tmp/safejs-conformance-current-recheck.json`.

Native RegExp import was intentionally implemented in local commit `daf40cd2a`.
The maintained positive import tests verify binding/return/settlement/argument/
import-meta routes, cursor isolation, quotas, native getter avoidance and replay.
The obsolete rejection assertion is inconsistent with current supported behavior;
do not undo the implementation to satisfy it.

An isolated correction in `/tmp/safejs-new-promise-capability.KGfWqD` replaces
the rejection with a public-run positive assertion for source, flags, initial
cursor, matching and advanced guest cursor, while checking the native cursor is
unchanged. It is outside the documented-deviations group. Conformance plus the
dedicated host-import file pass all 84 tests (1e88ed). Scoped lint passed (b806ca).

Main test sources remain unchanged until package gate 14148 is terminal.
Then integrate this one test file, rerun its focused routes and lint, and make
its own local test commit. Keep it separate from both camera optimizations and
camera test-name changes. No push or release during the hold.

Integration completed after gate 14148 ended: main conformance/import selection
passes all 84 tests (827111), and scoped lint passes (a53892). The source matches
the qualified isolated correction. This test repair does not resolve the other
26 failures observed in the full gate and makes no release claim.
