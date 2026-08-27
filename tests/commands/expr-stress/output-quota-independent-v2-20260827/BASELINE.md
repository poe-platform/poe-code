# Pinned baseline replay

Freeze commit: `2fc54ff3`. Freeze time: 2026-08-27T20:49:13.356Z.
Baseline replay: 2026-08-27T20:49:22.114Z–20:49:30.280Z.
Candidate receipt was still absent after baseline completion; no candidate source
or author acceptance evidence was read to design or adjust these controls.

Exact source commit: `7623599c995c42f62ec1cd9ad78ced2913970f66`.
Selected source/config/scoped-test archive SHA256:
`322ac32e805fe36ca9e1c50c45b7f9b2c282de95583ab8662b96f67108bba78f`.
This archive includes five scoped test/helper files beyond the old archive, so
its tar hash is intentionally different from the original review archive.

- Unchanged canonical original cohort: **36/47**, reproducing all 11 original
  failures. The original `stdout-rejection-normal-quota` remains a failure.
- New independent semantic cohort: **10/21**. All original and new failures and
  their exact attempted/accepted bytes are retained in `baseline-01/*results.json`.
- Source/declaration/actual-worker build passes; four existing scoped TypeScript
  test files and their helper compile with strict checking and skipLibCheck false.
  This is not runtime execution of those four existing test suites.
- Both probe children exit 0 without stderr. Zero unhandled rejections, zero
  main-thread matcher imports, zero live workers at settlement/after cleanup,
  zero safety terminations. Additional probe records zero uncaught exceptions;
  unchanged old probe has no uncaught monitor, so its exit/status/stderr supply
  the process-level evidence instead. Capture exit 0 is not semantic acceptance.
- Full post-run entry-set comparisons detect appended entries in selected
  archive/build, development dependencies and all three historical evidence
  directories. All are unchanged. Task-owned scratch is absent after cleanup.

No product edits, historical capture writes, native oracle recapture, public API
changes, full gate, performance or superiority acceptance is implied.
