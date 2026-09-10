# Report unit failure details promptly

The shared unit reporter printed a failed process-cleanup case after 296 ms but
deferred its ENOENT diagnostic until the 339-second shared phase ended. This
delays diagnosis while the rest of the maintained test queue runs.

Use the supported module-completion callback to print exact errors for failed
tests, suite hooks, and module collection immediately. Preserve the inherited
final report, including repeated details, counts, skips, and unhandled errors.
Do not change test membership, execution order, deadlines, or result handling.

Three regressions must fail before implementation and then verify that case,
suite, and module errors reach the native formatter before the remaining queue
finishes. Keep the existing summary, failure, interruption, and cleanup controls.

The three new controls failed before implementation; all 35 focused workspace
reporter and routing tests passed afterward in 343 ms. Evidence:
`/tmp/poe-688-reporter-immediate-red.log` and
`/tmp/poe-688-reporter-immediate-green.log`. The implementation uses one public
module-completion callback and the native error formatter without modifying
logger methods or queue results.

Native workspace runs inherit the root reporter configuration. The dot reporter
marks failures with `x` but suppresses their file and case names until the final
summary, delaying diagnosis during the long SafeJS phase. Use the built-in
default reporter for these runs so names appear at file completion. The shared
runner's explicit reporter override and immediate error details remain intact.
Passing output is one line per file plus slow-case lines, rather than one line
per test. This changes reporting only; test membership and results are unchanged.
