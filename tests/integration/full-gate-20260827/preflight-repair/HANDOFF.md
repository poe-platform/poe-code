# Bounded b494 handoff — 2026-08-27

The frozen result remains **16,520 pass / 307 fail / 13 skip, unqualified**.
Nothing here revises its expectations, evidence, or denominator. No new whole
suite is authorized or executed by this handoff.

## 1. Verifier prerequisite mistake

Preflight did run, but Curie incorrectly used the narrower metadata/archive/byte
helper inventories as a complete whole-suite inventory. Their checks passed for
their own assets. The broader canonical discovery did not have a matching native
requirement census, and the launcher recorded unavailable generic binaries rather
than consistently rejecting them. This was a verifier error, not absent approval
or an installation problem. The ignored binaries existed in the live checkout but
were absent from `git archive` and were not copied into its isolated snapshot.

These paths are relative to the snapshot repository root:

| Missing native path | Frozen effect |
| --- | --- |
| `tests/commands/metadata-stress/.oracle/coreutils-9.7/src/nl` | 28 direct failures plus its share of the 18 stream author-stress failures |
| `tests/commands/metadata-stress/.oracle/coreutils-9.7/src/seq` | 28 direct + 17 diagnostic failures plus its share of the 18 author-stress failures |
| `tests/commands/metadata-stress/.oracle/coreutils-9.7/src/unexpand` | 23 direct failures |
| `tests/commands/metadata-stress/.oracle/coreutils-9.7/src/split` | Six explicit external-oracle skips |
| `tests/commands/metadata-stress/.oracle/coreutils-9.7/src/date` | One format-matrix skip and contributes to the time-env native skip |
| `tests/commands/metadata-stress/.oracle/coreutils-9.7/src/sleep` | Contributes to that same time-env native skip, not an additional skip |
| `tests/commands/metadata-stress/.oracle/coreutils-9.7/src/printenv` | Contributes to that same time-env native skip, not an additional skip |

The 114 failures are exactly 28+28+17+23+18. The six affected stream test files
pass 122/122 after authenticated native staging in a fresh **same-source** copy.
Do not subtract those passes from the frozen score.

The other five skips are three `STREAM_NATIVE_LIVE` opt-ins (GNU tac/expand/fold
and Binutils strings profiles), one `GNU_TABLE_BIN` opt-in, and one
`TREE_NATIVE_BIN` opt-in. A qualified successor must explicitly bind those native
profiles or stop; silently leaving their environment variables unset is not a
qualified mandatory-native run. No downloads or installations are performed.

## 2. Ninety-nine guards are not caused by direct-curl

Both mismatches exist in the immutable Git commit **before any tests run**:

| Guard / number | Bound input | Expected / actual SHA256 |
| --- | --- | --- |
| `tests/shell-stress/diagnostic-profiles/compatibility.test.ts`, 89 hook failures | `tests/shell-stress/differential.test.ts` | `985d6e578841af649bbf4469fa69c48634070077baa9ecb85b60429da085e118` / `59027400ad1ea3741e652c49a50b03e076bb2672bc2c24cbee5c994caef1ec32` |
| `tests/shell/invocation-cleanup-public.test.ts`, 10 hook failures | `src/shell/shell.ts` | `0e1d1396490970bf8db4d74ab07115d73e8303d29d7b748e145a06b13b316fee` / `538f7ea1504019fcde03abc2781c1f903573243a0332033b87501804a1c4ac5c` |

First guard: `tests/shell-stress/diagnostic-profiles/profile.ts:97` compares the
historical evidence's test/helper hashes. Second: the canonical fixture's own
`before` hook at line 37 compares its earlier production-source pins. Their bodies
are not measured by these failures. Plato is assigned classification/migration;
these are not permission to remove guards or re-pin without independent evidence.

The distinct direct-curl writer at
`tests/stress/byte-ownership-20260827/remaining-consumers/direct-curl/direct-curl.test.ts:213`
overwrites `artifacts/direct-registered-curl-buffer-307-replay.json`. This produces
the **post-suite tracked-input mutation failure**, not either earlier source-hash
mismatch. Its isolated two tests pass while the JSON changes; before/after bytes
are preserved in the original capture. Arch owns the output-routing repair.

The new read-only preflight also finds a second diagnostic helper mismatch that
the first failing hook masked: `tests/shell-stress/current-gaps/compatibility.test.ts`,
expected `93f4d8dd5938ddba1464b126e5aec00c5304eacbd7470768e550301837dc4fa6`,
actual `ddf404839fae525ae5ebc6d4241c09be307b4ab9359c099d7f7dac67e2c975ca`.
This does not add failures to the original 89 or change their recorded first error.

**Subsequent root-relayed writer acceptance:** fixture repair `5f7fe5d7`,
independent `385c6af8` / `819e4105`, ten controls including overlap, sentinels and
19,773-file immutability; all 31 assertion/vector inputs unchanged. Canonical
execution writes no evidence files; explicit capture uses unique OS-temporary
output with source hashes and retained failures. Attribution `60ddeb07` confirms
the writer accounts for **zero of 99** TAP guard failures. This is separately
accepted evidence, not a rerun here or a revised b494 score. The next root-approved
candidate must include `5f7fe5d7`; its profile cannot be substituted under b494's SHA.
Report: `tests/stress/byte-ownership-20260827/remaining-consumers/writer-isolation-review/REPORT.md`.

## 3. The remaining ten exact failures

| Canonical path | Exact test name | Frozen / focused status and routing |
| --- | --- | --- |
| `tests/commands/metadata-stress/chmod-controls.test.ts` | GNU chmod directory setid controls compare actual host preservation | Fail: `6755 +2000`, native status 1 `Operation not permitted`, virtual 0. Host SGID/profile review; not rerun in focused batch. |
| `tests/commands/metadata-stress/native-differential.test.ts` | GNU chmod seeded symbolic/numeric differential: 384 mode transitions | Fail: directory `ug+s` cases; native 1/unchanged, virtual 0/changed bits. Host SGID/profile review; not rerun in focused batch. |
| `tests/commands/search-stress/differential.test.ts` | tests/commands/search-stress/differential.test.ts | File bootstrap fails: ten-second worker timeout at `harness.ts:31` / `differential.test.ts:85`; fresh serial same-source **486/486**, not proof against concurrency races. |
| `tests/commands/search-stress/safety.test.ts` | isolated cancellation and iterator lifecycle checks | Fail again: nested `cancellation releases stalled stdin`, `safety-cases.ts:39`, false versus true closure assertion. Search/runtime owner. |
| `tests/shell/remote-close.test.ts` | hard-deadline pipeline close: first-read-local | Fail again: custom pre-first-read 1200 ms deadline. Sagan/lifecycle review. |
| `tests/shell/remote-close.test.ts` | hard-deadline pipeline close: first-read-s3 | Fail again: same custom deadline. |
| `tests/shell/remote-close.test.ts` | hard-deadline pipeline close: first-read-webdav | Fail again: same custom deadline. |
| `tests/shell/remote-close.test.ts` | hard-deadline pipeline close: first-read-curl-body | Fail again: same custom deadline. |
| `tests/shell/remote-close.test.ts` | hard-deadline pipeline close: first-read-curl-headers | Fail again: same custom deadline. |
| `tests/stress/adapters/remote-safe-workflows.test.ts` | s3: named-file cleanup leaves parents and unsupported empty rmdir has no effects | Fail again at line 58: missing expected rejection after named-file cleanup leaves an empty explicit directory marker. FS fixture owner. |

Production routing sites, not independently established new root causes:
`src/commands/metadata/chmod.ts` / `src/fs/real/index.ts` for the host permission
profile; `src/commands/search/rg.ts` / `src/contracts/io.ts` for search input
closure; `src/shell/runtime.ts` / `src/shell/shell.ts` for custom first-read
lifecycle; `src/fs/s3/filesystem.ts` for advertised marker-only rmdir. The search
bootstrap timeout is in the test harness, not an identified production source bug.

For S3 the relevant contract is `src/contracts/filesystem.ts:34` and
`src/contracts/filesystem.md:40`: explicit `snapshotRmdir: true` permits supported
snapshot-empty **marker-only** removal. It never permits descendant deletion;
success need not imply logical directory absence after a concurrent child creation.
Stock/default strong empty-only semantics are not globally weakened. The old test
unconditionally expects `ENOTSUP` from both backends and does not select this
advertised profile. No assertion is changed here; preserve its historical result
and require a reviewed profile-specific migration with no-descendant controls.

## 4. Exact TypeScript diagnostics

`TYPE_DIAGNOSTICS.md` lists all **30** cold path/line/column/code rows and marks
the **11** that persist after build. Three `TS2749` errors are real test typing in
`tests/commands/file/text-bound.test.ts`; seven `TS2307` plus one `TS7006` come from
flattened historical tree captures. The nineteen build-first consumer diagnostics
comprise six `TS2307`, nine `TS7006`, and four `TS18046` in the three atomic-WebDAV
consumer files. They disappear in a fresh post-build check of the same candidate.
No production build errors occurred. This is classification, not a config fix.

## 5. Independent inventory-repair acceptance

**Accepted scoped repair** of source
`c3fbda6279028fd2bde9f6d967970870ff7546aa`: independent evidence **7f7764b5**;
separate manifest byte-authentication correction **c4783b71** (one terminal-LF
representation, unchanged JSON data). Report:
`tests/integration/qualified-current-release-inventory-independent/repair-review/README.md`.

- R1: unchanged service-free atomic consumer now executes with identity, not merely
  compiles; its failing sentinel really fails the runner.
- R2: missing mandatory canonical `.test.mts` runtime is rejected before work,
  including when `nodeTests` is omitted; missing runtime-result records are rejected
  afterwards. Guard-removal mutants expose false passes.
- Evidence: 18 strict groups / 29 inputs / 16 emitted programs, 24 canonical
  regression tests, 14 independent controls, four actual-runner controls, two
  guard-removal mutants. Noncurrent classification pins remain authenticated.
- The old `847dfd7` exit zero remains **incomplete-coverage historical**. The repair
  acceptance and same-candidate public replays do not qualify the 307-failure run.
