# Final current FS phase checkpoint — RED, verification only

## Frozen provenance

- Frozen immediately after reading applicable ancestor/root instructions on August 26, 2026, at 22:04:33 UTC. No delegation, implementation, fixes, assertion changes, repository writes, staging, commits, or repository cleanup were performed.
- Tested HEAD: `33ddb70c75865e3e695cf471b942ab0add98a891`.
- `src` tree: `b77579f5d588d441caf7969b1e56b3eb17229244`; `src/fs` tree: `721ea2a1a0681601f1b025dec4e8e4a6b3d4583d`.
- `tests/fs` tree: `9fab7c2bbcd52e1c0cea9e6b9a3a32958a26d75a`; revised matrix directory tree: `5e211a096890144ffdc4f66b50fb9c81311cefac`.
- All execution used `archive/`, extracted from `committed.tar`, not the live working tree. Cached `node_modules` was copied, not symlinked or installed. Installed packages match the archived lockfile: Node v22.22.2, npm 10.9.7, TypeScript 5.9.3, tsx 4.23.12, esbuild 0.28.2, @types/node 22.20.1; Darwin 25.4.0 arm64. Other installed locked packages and complete Node version metadata are in `tooling-final.json`.
- Archive SHA-256: `43ec745aa2c5fd5e75816171afad87247bbce390cd70b7268ecd61624f800ef9`.
- All 779 tracked archive files match committed Git blob IDs; all 117 source files remain identical before/after validation. Source-manifest SHA-256: `6398df6b913f832ffa8c9efa98743b40b93e6872f3f7a7eb29a766e4db618bec`. Whole tracked-file manifest: `dbee0280ca4c074ed2e05226c63b695c73b6f71f5431d293b3ce3f99b32e9dea`.

| Backend | Frozen source tree | Backend tests pass / total |
| --- | --- | ---: |
| memory | `909c8a4df46368a7cace98a9b4155287fe488989` | 77 / 77 |
| real | `8651d2725b83c4650c16edea5fa10787143a23e2` | 76 / 76 |
| S3 | `801723914b0be45f32739f5c3fa966a39e43fc0a` | 160 / 160 |
| WebDAV | `8105247fbb1a62e49d013ee3aa507d9e11a6d048` | 290 / 290 |
| readonly | `b058071bcbf6fca4ad858b03107fd71e512c21f2` | 102 / 102 |
| mount | `f034515e8f79f37229ec84a00d18befebda1d388` | 106 / 109 |
| overlay | `1010569f1b3ebc07eff8283fb653996fd0d3a10a` | 154 / 154 |
| shared conformance | test tree `0a24ec668e3d7bd1e50e5c2c72918ce962abe446` | 202 / 202 |
| **Entire tests/fs scope** | **44 test files; every archived entrypoint** | **1167 / 1170** |

Every per-backend test tree and every relevant committed test/source blob ID is retained in `frozen-tree-ids.stdout`, `frozen-test-blob-ids.stdout`, and `manifest-before.json`. The inventory includes all backend/wrapper stream, cancellation, traversal/path, race, metadata, replacement, identity and regression tests—not only integration matrix cases.

## Fresh required results

| Gate | Pass / total | Fail | Exit |
| --- | ---: | ---: | ---: |
| Revised aggregate matrix | 79 / 79 | 0 | 0 |
| Entire tests/fs, including shared conformance | 1167 / 1170 | 3 | mount group 1; all other groups 0 |
| Independent adapter stress, all four test files | 66 / 70 | 4 | 1 |
| S3 original policy cohort | 42 / 42 | 0 | 0 |
| S3 bounded policy cohort | 44 / 44 | 0 | 0 |
| Independent typed boundary diagnostics | 8 / 8 | 0 | 0 |
| Root wrapper export/isolation controls | 2 / 2 | 0 | 0 |
| Strict FS-scoped TypeScript, 76 .ts entrypoints | no diagnostics | 0 | 0 |
| **Test aggregate** | **1408 / 1415** | **7** | **RED** |

All test runs have zero skips, TODOs, or cancellations. Each required gate ran once. The complete tests/fs denominator is the sum of disjoint per-directory invocations, not a claim that only one backend subset covers FS. The seven implementation groups plus shared conformance reproduce the historical 1167/1170 total on this fresh pin. The wider independent safety denominator reveals four additional red cases, not only the previously noted S3 default assertion.

Matrix counts: memory 11/11, real 11/11, S3 11/11, WebDAV 11/11 (required subtotal 44/44); mount 12/12 (11 common + cross-backend composition); overlay 12/12 (11 common + lower-preservation composition); readonly 10/10; standalone jq split 1/1. No fixtures or expected behavior were modified for this run.

Historical **ORIGINAL `6a259ff` modern-source 71/79** remains a distinct, previously recorded cohort and was not rerun or relabeled as 79/79. Its initial old-source 58/79 observation also remains historical. This run evaluates the committed revised matrix including `d0fed8f`, `df5bc45`, and `33ddb70`.

## Exact red cases and ownership seams

1. `direct cross-mount copy rejects a real same-path alias without touching source bytes` — `tests/fs/mount/copy-identity.test.ts:14`.
2. `direct cross-mount copy rejects a real hardlink alias without touching source bytes` — same entrypoint.
3. `direct cross-mount copy rejects a real symlink alias without touching source bytes` — same entrypoint.

All three fail at the byte-preservation assertion on line 31: the 15-byte `alias sentinel\n` becomes an empty Uint8Array. This is observed data loss, not only the wrong error spelling/status. Two Real adapter instances address the same host root; mount routes them through its cross-backend streaming branch, where destination `w` publication precedes safe source identity handling. Source seam: `src/fs/mount/index.ts:396`, especially lines 403–419, versus Real adapter alias identity. Poincare owns the FS source/tests; any shared identity contract change must be coordinated with Curie. The fourth synthetic-dev/ino-collision control passes: globally comparing arbitrary backends' synthetic numbers is not a demonstrated fix. No alias failure was waived or repaired.

4. `s3: optional metadata capabilities are exercised or fail closed` — `tests/stress/adapters/core.test.ts:26`, failing line 36 with `Missing expected rejection.` The adapter advertises `permissions: false` but `writeFile('/mode', ..., {mode: 0o600})` resolves rather than the required ENOTSUP. Seam: capability/creation-mode-hint semantics versus this existing safety assertion. Poincare owns adapter and stress; Curie owns shared contract semantics. This remains red; no inference that ignoring a mode hint establishes permissions support.
5. `s3: optional truncate preserves exact bytes or rejects without mutation` — `tests/stress/adapters/core.test.ts:55`, failing line 64 with `Missing expected rejection.` The test's backend-name branch expects S3 truncate always ENOTSUP; the current `src/fs/s3/filesystem.ts:731` implements truncate. This is a negative-expectation/current-supported-operation seam for Poincare, not authorization to silently weaken the test. It remains red in the unchanged safety denominator.
6. `webdav: optional metadata capabilities are exercised or fail closed` — `tests/stress/adapters/core.test.ts:26`, failing at line 43: `ENOTSUP: WebDAV HTTP status 501, PROPPATCH '/file'`. Timestamp capability leads the shared loopback MockDav fixture to invoke utimes, but that provider fixture cannot perform PROPPATCH. Seam: advertised timestamp capability/provider negotiation and fixture interoperability, Poincare. Passing property-aware WebDAV backend tests does not waive this shared-provider failure.
7. `s3: default rename explicitly fails closed without opt-in` — `tests/stress/adapters/s3.test.ts:101`, failing line 106 with `Missing expected rejection.` Current S3 defaults `allowNonAtomicRename` to true (`src/fs/s3/filesystem.ts:119`), with negotiated guards; the old assertion expects default ENOTSUP before requests. Poincare owns this source/legacy-expectation seam. Independent 42+44 tests pass the current guard and partial-effect policy; this old negative assertion nevertheless remains an exact red, not an implicit skip.

Raw errors, stack locations, expected/actual bytes and all test output are in `fs-mount.stdout` and `adapter-stress.stdout`; every suite has separate `.stdout`, `.stderr`, and `.exit.json` files.

## Commit closure and exclusions

All user-specified commits resolve to full SHAs and are ancestors of the frozen HEAD. `commit-inventory.json` contains exact full SHAs, ancestor exit codes, author/commit dates, subjects and every changed path; corresponding `commit-<short>.stdout` files retain unabridged Git output:

- S3 fixes: `1c846a1ff39974d5b2fa330d2d55e07f523fd30e`, `acef1118fe4e5e0342114ee7d28de5ea02df2327`, `d52634b04aa2c91f52e5bf8c331bc6e9a7b35a95`.
- WebDAV fixes: `a5d68b970412248b67d48cf747ab0d86a2ae2ba7`, `9e905738e9b71a7a91a7f868a1716c618c9b7ec5`.
- Wrapper fixes: mount `402bda83fb93587337b53ee247e1c49a6bf1ebaf`, readonly `b05b7344d1ae7c250b7cda653e8f2b248ca1f574`, overlay `78f5cd64a8e4b4fbd0b9d646b41b266fa498a6f6`.
- Documentation checkpoint: `001123174c7e93487bc7b89f4a52db7a416e45ac`; matrix `d0fed8f`, `df5bc45`, `33ddb70`; direct alias reproduction `d4f5e53`. Full expansions and paths are in the inventory, not guessed from names.
- Complete FS source history and exact post-original source patches are in `complete-fs-source-history.stdout` and `known-source-fixes-exact-patches.stdout`. The latest committed FS source change remains `d52634b`; no later FS source fix is present at the pin.
- Between the previous `faca7b4` checkpoint and this pin, the relevant FS/test history contains only `33ddb70`'s matrix README and append-open FsError assertion change. No mount alias source fix is present.
- The live repository advanced during execution to `efa56b3adbb6f0f78bde0050c11fbad6dae32672` through three unrelated diff/patch commits. Their exact paths are in `final-history-and-owned-state.log`. The frozen-vs-live diff for FS source, tests/fs, adapter stress, S3 policy and matrix is empty. Their command changes were not overlaid or retested as part of this frozen checkpoint.

Before/after the audit, `src/fs/**`, `tests/fs/**` and `tests/integration/adapter-tools/**` are clean: no staged, modified or untracked candidate is excluded in that owned scope. Initial three committed-source/staged/unstaged patches are empty. Broad safety-state capture additionally records concurrent uncommitted work and does not conceal it:

- Initially untracked `tests/stress/remote-cancellation/{helpers.ts,remote-cancellation.test.ts,run.mjs,tsconfig.json}`; `capture.mjs` and `evidence.json` appeared by the expanded baseline. The entire directory is absent from committed HEAD, hence excluded from the committed-source test and typecheck cohorts. It belongs to the active independent remote-cancellation leaf, not this audit. Its absence is not a passing result.
- By the after capture, `tests/integration/adapter-tools-diagnostics/revision-loader.mjs` is modified and `check-append-closure.mjs` is untracked. These independent worker candidates were not copied into the archive. The tracked diagnostic diff is retained verbatim (1061 bytes in the after snapshot); scoped staged diff is empty.
- Initial unrelated diff/patch source edits, SafeJS files, generated report and native-oracle temporary files are recorded in `status-before-all.txt`; subsequent all-repository states are retained separately. None was altered, staged, deleted, or included in an archive overlay.

The snapshot is a frozen committed-source checkpoint, not certification of uncommitted remote-cancellation candidates or of the moving repository.

Final capture addendum (recorded by 22:13:06 UTC): live HEAD reached `ed11dd707e78b896283071221168958e7ad10d2a`, and the expanded scoped working-tree/index state is clean. The prior excluded remote-cancellation files were committed by their owner as `4e26ce0d386b9f3fcd25c3d540b5d43361b056d3`; independent append-closure diagnostics were committed as `b797f43bb28eae609f5ff7f079ba636187240f13`. They remain absent from the frozen `33ddb70` test cohort and were not opportunistically overlaid or rerun. `final-captured-head-history.log` records every intervening commit/path and confirms an empty frozen-to-final diff for all seven FS sources, tests/fs, adapter stress, S3 policy and the revised matrix. These later safety-artifact commits are not subsequent FS implementation fixes. The final manifest still matches all 779 committed files and 117 source files. This audit spans approximately nine minutes of observed work, not the project's requested 72 hours.

## Preserved limits and auxiliary observations

- S3 still advertises `atomicRename: false`. Capable-client ordinary rename is guarded but non-atomic; conditional PUT fallback, preflight refusal of unsafe capabilities, acknowledgement checks and explicit partial failures are tested by the passing original42+bounded44 cohorts. There is no claim of rollback or global atomicity.
- Fresh `observe.ts` records same-content recreation with unchanged ETag: rename resolves and the replacement source is deleted. Fresh bounded identity observations resolve all 18 schedules with no source remaining, across modern-copy/classic-put/stream-put and publish/delete stages. These are documented identity limitations, not 18 acceptance passes: equal ETag does not establish object incarnation identity or rule out ABA.
- Fresh directory observation leaves `source/new` while moving `source/old` to `target/old`; rename resolves. Preservation of new children is not an atomic directory snapshot or proof the source path vanished.
- Local memory/real fixtures, the S3 mock and loopback WebDAV are the exercised providers. No deployed S3/WebDAV endpoint, signing client, object versions/locks or arbitrary-provider cancellation guarantee is established. WebDAV's shared timestamp failure makes provider interoperability limitations concrete.
- Existing adapter pagination mutation probe exits 0 and detects its in-memory pagination-cycle mutation; no production source was edited. Existing atime probe runs 500 samples for each native/adapter × historical/future-exact/future-millisecond cohort. Both future controls have zero atime/mtime mismatches at all three phases; historical immediate atime mismatch counts are 13 native and 11 adapter, and both historical after-read phases mismatch 500/500. This is retained as host-atime diagnostic evidence, not converted to a test pass or attributed to a proven external cause. All four auxiliary scripts exit 0 and remain outside the 1415-test denominator.

## Native leaf process accounting

Raw `ps -axo pid=,ppid=,lstart=,etime=,args=` output is retained before/during/after/final. Exact native executable command lines—not broad `pgrep` matches—identify:

- This audit: PID 90172, `-o /tmp/safe-bash-fs-current-checkpoint-final.txt`.
- Prior/other FS-related remote-cancellation leaf: PID 66163, `-o /tmp/safe-bash-remote-cancellation-audit-report.txt`.
- Separate diagnostic closure leaf: PID 479, `-o /tmp/safe-bash-diagnostics-33ddb70-closure-report.txt`.
- Unrelated shell leaves: PID 79549, `-o /tmp/safe-bash-shell-diagnostic-profiles-verifier-final.txt`; PID 81063, `-o /tmp/safe-bash-shell-diagnostic-author-final.txt`.
- Unrelated SafeJS leaves: PIDs 69745 and 72481 use `--output-last-message /tmp/safe-bash-safejs-isolated-patch-result.txt` and `--output-last-message /tmp/safe-bash-safejs-isolated-security-review.txt`, respectively, not `-o`.
- Unrelated diff/patch author/regression leaves: PIDs 85545 and 97755 have no `-o` output argument. Exact prompts establish their scope. The preliminary JSON heuristic labels PIDs 69745/97755 “other FS-related” because their prompts mention FS exclusions; this manual classification supersedes that heuristic, not the raw command evidence.

No separate older generic FS checkpoint native leaf is observed in these process snapshots; that is an observation at capture time, not proof an earlier worker never existed. No process was stopped or signalled by this audit.

## Inventory and reproduction

`suite-inventory-final.json` lists every selected archived test entrypoint, including the root wrapper controls; `results-final.json` contains the complete 1415-test aggregate and stability/typecheck records. Earlier `suite-inventory.json` and `results.json` retain the pre-wrapper-control batch separately. `typecheck-entrypoints.txt` lists all 76 FS/source/helper/test TypeScript roots. No global build/typecheck or command/shell/SafeJS suites were run. The two FS wrapper cases in mixed `tests/stress/root-exports.test.ts` were selected by their exact names; its unrelated command-export case was deliberately outside FS scope, not a waived FS failure. The matrix necessarily exercises real public command/shell dispatch without expanding into unrelated command suites.

`commands.jsonl` records exact executable, argv, working directory, environment overrides, start time and timeout for each audited command; `audit.mjs` is the retained runner. `provenance-setup.log`, ancestor AGENTS copy, immutable archive, lock/tooling metadata, full source/history inventories, before/after/final status and patches, test raw output, exit metadata and hash manifests are all retained in this evidence directory. No gate was weakened, retried to hide a failure, or replaced by a capability skip. Required validation is finished; this checkpoint returns control to the FS owner without extending the work into fixes or new tool batches.
