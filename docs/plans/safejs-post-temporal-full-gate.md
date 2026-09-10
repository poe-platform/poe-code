# Full SafeJS gate after Temporal integration

## Candidate

Local HEAD is `288c69643`. The worktree also includes pending intrinsic-parent,
weak-serialization and other changes. This gate qualifies the worktree, not an
isolated committed tree or a release.

`npm test --workspace=@poe-code/safe-js` started in session 15942. All 100
filesystem type contracts passed before the full package unit runner started.
Do not infer a terminal unit result from this document: poll the actual handle.

The preceding focused intrinsic-prototype and retained-root accounting run
passed 57 tests in two files. That is not a substitute for the package gate.

## Source freeze

Keep SafeJS source, tests, scripts and manifests unchanged until the run ends.
The pre-run fingerprint contains 1,594 tracked or nonignored untracked paths
under src/test/scripts, package.json, tsconfig.json and root vitest.config.ts.
Paths are deduplicated and sorted. Each entry is [path, SHA-256(file bytes)];
the aggregate is SHA-256(JSON.stringify(entries)):

`af0f0a86c9b9afc0014f22f40de48bb49202b1267aecb82c2d8d833c3818bdc3`

The tool store retains the entries as `postTemporalGateFingerprint`, launch
result as `postTemporalGateStart`, and subsequent output as
`postTemporalGateChunks`. Compare file membership and hashes after completion.
Ignored generated Intl data and external dependencies are not fingerprinted.

## Pending result

The previous package gate failed; no new green gate is claimed. Await terminal
counts, inspect every failure and verify the source fingerprint before choosing
the next code change. Do not restart a still-live handle or change timeouts to
obtain a pass. No pushes, releases or issue closures during the release hold.

## Terminal result and fingerprint

Session 15942 terminated with exit 1 (5cd9b0): 27,437 tests passed, 10 failed,
48 skipped, 27,495 total. Files: 1,196 passed, five failed, two skipped, 1,203
total. Duration: 1,083.80 seconds. All 100 pretest filesystem contracts passed.

Post-run check 6cc8b8 matches all 1,594 fingerprinted paths and the aggregate
hash above exactly. Documentation-only commits during the run did not change
the tested source tree. The source freeze is now ended.

Failures:

- `array-buffer-host-compatibility.test.ts`: fixed-buffer compatibility with
  host methods beginning at `resize` unavailable, 5,000 ms timeout.
- `float32-camera.test.ts`: one complete inverse-coordinate native/recorded
  batch trace, 5,000 ms timeout. The terminal label is truncated; identify the
  exact batch before attributing a particular fixture.
- `promise-import-properties.test.ts`: native Promise string descriptor and
  user-symbol property import, two failed assertions.
- PlainMonthDay locale: UTC, Pacific/Honolulu and +05:30 produce a missing
  ISO-calendar month name, three failed assertions.
- PlainYearMonth locale: the same three zone cases fail the native month-name
  precondition before guest comparison.

The earlier regex/split timeout failures and reconciled null-prototype clone
assertion did not fail this run. This does not establish a timeout repair;
the package gate is still non-green. Focused Temporal, restored bound-call and
realm integration results are not substitutes for this terminal result.

The newly validated internal continuation reference-admission cases were
read-only probes outside this frozen test suite and are not included in its
pass/fail count. The next code change must add failing regressions and restrict
those references without breaking their legitimate internal owners.
