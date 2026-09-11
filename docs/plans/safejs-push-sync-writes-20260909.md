# Preserve synchronous push writes without redundant awaits

## Evidence and scope

- September 9, 2026: remote CLI release 34312551079 at
  `d45e9edec6cc45ad3d899b696ba9c353bc5749c6` fails its fresh unit job.
  The completed raw job log identifies one failure: the 600,000-element
  push-spread regression exceeds its unchanged five-second timeout.
  `/tmp/kamilio-remote-d45e9ed-unit-raw.log` is authoritative; the earlier CLI
  log retrieval omitted the terminal failure section and is retained separately.
- Keep the complete 600,000-element fixture, native RangeError assertion,
  output assertions and timeout unchanged. The earlier maintained plan records
  that 250,000 elements did not cross the Vitest worker's native limit.
- This atomic change covers only `src/interp/methods/array.ts` and its adjacent
  test file. A separate rejected measurement-allocation experiment is tracked in
  `safejs-bounded-array-measurement-20260909.md`.

## Validated change

- Every element still calls `writeArrayProperty`, including all existing step,
  length, receiver and setter checks. Await an actual returned setter operation;
  do not manufacture a suspension when the setter completed synchronously.
  The final length write and its existing error behavior remain unchanged.
- A native Proxy setter control records writes `0`, `1`, `length`, then a queued
  microtask. The old implementation instead runs the microtask between writes
  `0` and `1`. The added test fails on the old code and passes after the change.
  A separately held asynchronous setter confirms the next write remains blocked
  until that setter resolves. Both tests use only in-memory state.
- Red: `/tmp/kamilio-remote-spread-write-order-red.log`. Green:
  `/tmp/kamilio-remote-spread-write-order-green.log`, three selected tests pass,
  including the unchanged 600,000-element regression. Filtered-out tests are
  not counted as passes.
- One local baseline measured 2,482 ms; this change measured 2,328 ms. These
  cohosted observations show only modest improvement, not CI recovery proof.
  A separate attempted descriptor-data shortcut measured insignificantly and
  was removed completely; `interpreter.ts` is unchanged.

## Completed local gates and remaining delivery

- Independent review passes 141 controls plus 12 supplementary controls on
  source hash `5432119c06cd90f8ab6bc5941b3c9d26e10140322b0a6842ac5a863931b50f4a`.
  Receipts: `/tmp/array-release-review-20260909.json` and its `-supplement.json`.
- The initial combined package run failed the separately attempted measurement
  shortcut's sparse-array work invariant. That shortcut and its experimental
  tests were withdrawn; the original sparse invariant remains unchanged.
- With only the synchronous-write repair present, normal build, full root lint
  and the complete maintained uncached `npm test` route exit 0. Its SafeJS phase
  reports 21,653 passes and 37 skips in 412.76 seconds, including the unchanged
  600,000-element host-overflow regression. Candidate hashes are unchanged across
  the full route. Receipts use `/tmp/kamilio-677-corrected-`; this gate also covers
  the independent numfmt integration, rather than claiming an isolated commit.
- Keep this improvement separate from numfmt and measurement allocation in Git.
  No remote mutation has occurred. Push/closure approval remains pending, and
  only a verified successful future release can establish publication recovery.
