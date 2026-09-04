# Issue #585: one deadline per WebDAV ancestor walk

## Validated defect

A bounded in-memory witness with sixteen existing ancestors and a missing leaf
made seventeen requests, each with a separate timeout signal. Five-millisecond
responses completed the walk in 111 milliseconds despite timeoutMs being 50.
The result was ENOENT, not ETIMEDOUT. This confirms the aggregate-deadline gap;
it does not reproduce the issue's hour-scale duration estimate.

Current main has a 256-component/64KiB guard only for directory-access checks.
A new failing test shows stat does not use it. Apply those same bounds to the
cited walks while preserving existing access behavior, validation ordering,
caller-cancellation priority and late-response cleanup.

## Implementation

Give stat's fallback ancestor walk and prepareWrite's shared preflight a lazy,
operation-owned deadline. Nested stat calls in write preflight borrow the same
deadline. Start it on the first actual request, and dispose it when the walk
settles. Independent calls must not share a deadline merely because their caller
reuses an options object. Preserve per-request timeout behavior outside a walk.

Keep the existing writeFile/writeStream content-acquisition and publication
lifecycle unchanged. This bounds the cited remote walks, not every compound
filesystem operation or uncooperative arbitrary host work.

## Verification and delivery

Use failing fake-clock tests for stat, writeFile and writeStream ancestor walks
before implementing. Verify that expired preflight never dispatches PUT or
acquires the upload source; apply the existing access bounds to these walks. Cover nested walks,
independent calls, caller cancellation and deadline disposal. Run the maintained
safe-fs suite and relevant downstream WebDAV tests, selected build and guarded
repository lint. Commit separately, verify remote main, close on delivery and
monitor the scoped release while continuing issue work.

## Verification record

- The initial four regressions failed before implementation: the three walks
  exceeded their aggregate deadline, and stat did not enforce the access path cap.
- All 45 safe-fs test files pass: 1,034 tests, including eleven new walk cases
  and the existing deadline lifecycle, cancellation and late-response checks.
- Both selected workspace builds pass. Downstream shell tests exposed an older
  public safe-js bundle, not a capability-contract defect. Rebuilding only the
  safe-js closure does not generate the root-owned public safe-fs bundle; the
  maintained full `npm run build`, including its root suffix stages, passes and
  regenerates that export. No capability assertions or behavior were changed.
- Against that fresh public bundle, all 48 selected shell WebDAV tests pass.
- Repeating the bounded real-clock witness through both current source and
  `poe-code/safe-fs` gives ETIMEDOUT after 51 ms with one shared timeout signal
  and seven admitted requests. These timings describe this witness, not a hard
  CPU deadline or a deployed-service guarantee.
- Guarded repository lint passes: 9,646 configured/linted files, zero errors
  or warnings, and all 25 boundary receipts. This ran before fast-forwarding
  unrelated lint-matching and smoke-diagnostic commits from remote main;
  the WebDAV candidate bytes are unchanged by that integration.
- The incoming lint/smoke focused regressions pass after fast-forward:
  271 tests across three selected/related files.
- Remote delivery remains required before closing; publication is tracked
  separately from issue closure.
