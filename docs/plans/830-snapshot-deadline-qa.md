# Snapshot deadline QA

1. Run the maintained safe-bash test route with the snapshot deadline, native
   snapshot, controller, open-options, standard-session, profile-configuration,
   session-restore, interrupt and snapshot test files. Require all nine files to
   complete with no failures, cancellation or skipped tests.
2. Run fresh repository ESLint and the maintained safe-bash typecheck with a
   run-specific report. Check completion and every expected typecheck phase.
3. Run the existing native snapshot navigation integration tests against installed
   Playwright and Chromium. Require normal completion and executed passing tests.
4. In a fresh native browser context, populate a page with 20,001 buttons. Wrap
   the native snapshot method to record its supplied timeout and capture duration,
   then run the controller's first snapshot with sufficient byte/ref admission.
   Require a 30-second native deadline, complete output, and unchanged button
   count and page title afterward. Save and inspect a screenshot. This first
   capture is the cold-page check; passing retries are insufficient evidence.
5. Check `config-print` and JSON/INI overrides, including zero and explicit action
   limits, through the deterministic regression tests. Existing interrupt and
   native snapshot regressions must preserve cancellation and stale-ref behavior.

Keep temporary output in `out` and remove it after verification. Per-reference
publication cost remains independent of the native capture deadline; record total
controller duration separately from native capture duration.
