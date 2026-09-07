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
