# Independent committed FS refresh — 3731587

**WebDAV cancellation improvement independently confirmed; aggregate checkpoint remains RED.**

## Provenance and scope

- Pin: `3731587fa287333ca59c7a81569b367cec66f61d`, frozen at **2026-08-26 22:30:56 UTC** in this directory's fresh `committed.tar` and `archive/`. Tests ran once, 22:32:45–22:32:58 UTC, followed by strict typechecking and final hash/status capture.
- Read ancestor/root AGENTS; no nested AGENTS found in the relevant archived FS/test scopes. This is a leaf verification: no delegation, repository edits, test changes, docs changes, staging, commits, cleanup, or stopping other workers.
- Copied cached tooling matches the archived lock: Node **v22.22.2**, npm **10.9.7**, TypeScript **5.9.3**, tsx **4.23.12**, esbuild **0.28.2**, @types/node **22.20.1**, Darwin 25.4.0 arm64. No dependency installation or live-source overlay.
- Only new FS source commit since the prior audit's `33ddb70` pin is **3731587**, verified by path-filtered history. Its exact six paths are `src/fs/webdav/{webdav.ts,README.md}` and `tests/fs/webdav/{fetch-cancellation.test.ts,lock-cancellation.test.ts,tsconfig.json,CANCELLATION_RECHECK.md}`. Full commit metadata and patch are in `setup-and-change-review.log`; full prior phase commit list remains in `/tmp/safe-bash-fs-final-20260826T220433Z-f67gpP/REPORT.md` and its commit inventory.
- The committed remote audit is byte-identical to **4e26ce0d386b9f3fcd25c3d540b5d43361b056d3**. Independent diagnostic closure artifacts are byte-identical to **b797f43bb28eae609f5ff7f079ba636187240f13**. Both comparison outputs are empty, retained as evidence.
- Every archived `tests/fs/**/*.test.ts` entrypoint ran: **45 files**, seven backend/wrapper groups and shared conformance. All four adapter-stress files, both S3 policy files, unchanged remote24 and independent diagnostics8 also ran. Exact inventory/argv are in `suite-inventory.json` and `commands.jsonl`.

## Fresh results

| Gate | Pass / total | Fail | Exit |
| --- | ---: | ---: | ---: |
| Revised matrix | 79 / 79 | 0 | 0 |
| Memory backend | 77 / 77 | 0 | 0 |
| Real backend | 76 / 76 | 0 | 0 |
| S3 backend | 160 / 160 | 0 | 0 |
| **WebDAV backend** | **308 / 308** | **0** | **0** |
| Readonly wrapper | 102 / 102 | 0 | 0 |
| Mount wrapper | 106 / 109 | 3 | 1 |
| Overlay wrapper | 154 / 154 | 0 | 0 |
| Shared conformance | 202 / 202 | 0 | 0 |
| **Entire tests/fs** | **1185 / 1188** | **3** | **RED** |
| Independent adapter stress | 66 / 70 | 4 | 1 |
| S3 original policy | 42 / 42 | 0 | 0 |
| S3 bounded policy | 44 / 44 | 0 | 0 |
| Unchanged remote cancellation | 22 / 24 | 2 | 1 |
| Independent eight baseline diagnostics | 8 / 8 | 0 | 0 |
| Strict FS TypeScript, 79 entrypoints, --noEmit | no diagnostics | 0 | 0 |
| **Combined nonduplicated test total** | **1446 / 1455** | **9** | **RED** |

Every gate ran **once**, with **0 skips, 0 TODOs, 0 cancellations**. The aggregate excludes the bold tests/fs subtotal to avoid double counting. The new WebDAV 18 tests account for the increase from the prior 290 to 308. The author's targeted31 ten repetitions and full22/24 three repetitions are historical author evidence, not claimed as independent repetitions here.

Matrix: memory **11/11**, real **11/11**, S3 **11/11**, WebDAV **11/11** (required subtotal **44/44**); mount **12/12**, overlay **12/12** (each includes its separate composition case); readonly **10/10**; jq split **1/1**. Historical ORIGINAL `6a259ff` modern-source **71/79** is a separate, unrerun cohort.

## Cancellation delta and unchanged failures

**Remote original remains 20/24 with four failures** at the original audit revision. This new pinned-source run is **22/24**, not a rewrite of the original evidence:

- **D02 PASS**, 3 ms total; trace shows ECANCELED with `waitMs=0` before the fixture releases its ignored PROPFIND fetch.
- **D05 PASS**, 1 ms total; outward ECANCELED precedes late GET response release and body cancellation is observed. Exact events are in `remote-selected-rows.json` and `remote24.stdout`.
- D02/D05 originally used signal-ignoring injected transports **outside the then-documented transport contract**. Keep that original classification: the improvement is bounded outer waiting and late cleanup, not proof those original observations were compliant-provider cancellation failures.
- **S08 FAIL:** `S08 S3 aggregate head early exit cancels upstream GET`; `DEADLINE: head early exit (1200ms)`, observed 1203 ms. Head already settled with `first\n`; upstream signal remains live and iterator return count is zero until rescue caller cancellation. **Owner: Sagan / shell downstream early-exit cancellation.**
- **D08 FAIL:** `D08 native HTTP WebDAV aggregate head early exit cancels GET socket`; `DEADLINE: HTTP head early exit (1200ms)`, observed 1207 ms. Head already settled; GET remains open until rescue caller cancellation. **Owner: Sagan / shell downstream early-exit cancellation.** No waiting for or overlaying that worker's changes.

The seven earlier FS/safety reds reproduce unchanged:

1. `direct cross-mount copy rejects a real same-path alias without touching source bytes`.
2. `direct cross-mount copy rejects a real hardlink alias without touching source bytes`.
3. `direct cross-mount copy rejects a real symlink alias without touching source bytes`.

All three are `tests/fs/mount/copy-identity.test.ts:14`, failing its source-preservation assertion at line 31: 15-byte `alias sentinel\n` becomes zero bytes. **Poincare: mount/Real cross-backend identity and streaming-publication seam**, with Curie coordination if shared identity contracts change. The synthetic dev/ino-collision control passes; arbitrary cross-backend dev/ino equality is not a demonstrated remedy.

4. `s3: optional metadata capabilities are exercised or fail closed` — `tests/stress/adapters/core.test.ts:36`: expected ENOTSUP for a creation mode despite `permissions:false`, but write resolves. **Poincare/Curie capability versus mode-hint contract seam.**
5. `s3: optional truncate preserves exact bytes or rejects without mutation` — `tests/stress/adapters/core.test.ts:64`: old S3-name branch expects rejection, current truncate resolves. **Poincare supported-operation/legacy-negative-expectation seam.**
6. `webdav: optional metadata capabilities are exercised or fail closed` — `tests/stress/adapters/core.test.ts:43`: `ENOTSUP: WebDAV HTTP status 501, PROPPATCH '/file'`. **Poincare advertised timestamps versus shared MockDav provider capability seam.**
7. `s3: default rename explicitly fails closed without opt-in` — `tests/stress/adapters/s3.test.ts:106`: expected rejection is missing because current capable-client ordinary rename is enabled with guards. **Poincare current rename-policy/legacy-negative-expectation seam.**

No red expectation was weakened, skipped or reclassified as a pass. Exact raw errors and byte differences are retained in each suite's stdout/stderr files.

## Focused implementation review

Reviewed `src/fs/webdav/webdav.ts:186`–256 and `:731`–775, the new 18 tests and preserved LOCK cancellation controls:

- A supplied caller/deadline signal now rejects the pending fetch-response wait. An abort listener is installed before transport invocation; synchronous throws and asynchronous rejection both remove it. Late fulfillment/rejection is observed through handlers, with the trailing rejection handler retaining late thrown-error observation.
- The abandoned-response branch never resumes the ordinary consumer/transfer. It first applies existing redirect/resource checks, then best-effort cancels an unlocked late body without awaiting cancellation; cancel rejection is observed. Normal completion and failure also dispose unlocked bodies in finally. Caller/deadline errors remain typed ECANCELED/ETIMEDOUT with cause translation.
- A late successful LOCK response must pass response-origin/resource/redirect and token checks before detached best-effort UNLOCK. Cleanup uses a fresh deadline rather than the canceled caller signal; cleanup request errors are caught. The detached path never performs COPY/MOVE. Existing unsafe-token/redirect/wrong-resource checks remain, and new success/noncooperative-UNLOCK tests pass.
- No concrete new defect was established in this narrow helper review. This is not exhaustive proof of transport behavior. The promise race bounds the outward **fetch wait**, not synchronous host work, ignored transport lifetime, sockets, accepted remote effects or rollback. Failed/unavailable late LOCK responses, unusable tokens and unsuccessful UNLOCK can still leave remote locks until expiry. The accepted-MOVE test explicitly preserves the already-applied effect after cancellation.
- S3 `atomicRename:false`, guarded non-atomic fallback/partial failures, same-ETag ABA/object-incarnation limits and directory-snapshot limits remain unchanged. This refresh did not rerun auxiliary observations or claim those limits fixed. Local mock/loopback success is not deployed-provider interoperability certification.

## Hashes, working state and active leaves

- `src` tree: `925d3a43c46bd0f4094559d003193e7963780444`; FS tree: `7027443bf082477a1f3ce153829dcecbb3e4149e`; WebDAV source tree: `1bd241ac876f56418a02bb79e4fba1da1280ce82`; WebDAV implementation blob: `c4555573c49c404670b1688958bdabcf06083197`.
- `tree-ids.json` records all seven source trees, backend test trees, complete tests/fs and safety/diagnostic trees. `manifest-{before,after}.json` records exact Git blobs and SHA-256 for **225 scoped files, including all 117 source files**. All match the pin and remain stable: manifest SHA-256 `82c13e91ae4c8ac0ed8821031f44a231c21db2419691b78585f399cf7ca97df7`.
- Archive SHA-256: `77b5fca312b6fb0ebd72a3177533f21f8414f089d264278ca3d5458cd7119ec1`.
- Seven-backend source/test staged/modified/untracked status is empty both before and after. Expanded FS/safety status, pin-to-live source/test diff, pin-to-index diff and unstaged diff are also empty; no FS candidate is silently excluded. Captured live HEAD is `695eb079c223077da2010872d59effdff15b17f3`, not used as the test pin. `pin-to-captured-live-history.log` records intervening history without chasing moving HEAD.
- Raw exact `ps -axo pid=,ppid=,lstart=,etime=,args=` output and parsed native command lines are retained before/after. This audit is **PID 90673**, `-o /tmp/safe-bash-webdav-frozen-fs-checkpoint-final.txt`. Shell early-close author **77470** uses `-o /tmp/safe-bash-shell-remote-close-author-final.txt`; independent shell reviewer **80241** uses `-o /tmp/safe-bash-shell-remote-close-review-final.txt`. These are separate workers, not duplicate FS checkpoint invocations.
- Unrelated workers include curl preparation **69557** (`-o /tmp/safe-bash-curl-independent-preparation-report.txt`), SafeJS **81099/92837** (long `--output-last-message` arguments captured verbatim), and independent command checkpoint **37951** (no `-o`). No old generic FS audit native leaf is observed in these snapshots. No other process was stopped or signalled by this verifier.

`run.mjs` was read before execution: it imports only child_process, emits console output, and does not write evidence/source/test files. It manages only its own spawned audit group; no outer watchdog or residual-group cleanup fired. We ran `AUDIT_REPEATS=1 AUDIT_VERBOSE=1` with `AUDIT_CASE` removed, retaining all 24 cases and full raw diagnostics. No mutant, atime, auxiliary observation, root-export, global test, build or unrelated suite ran. Required gates are finished; no retry or feature/fix work follows this checkpoint.

Machine evidence: `checkpoint.json`, `summary.json`, `results.json`, `suite-inventory.json`, `commands.jsonl`, `tooling.json`, `tree-ids.json`, `stability.json`, `remote-selected-rows.json`, and each command's `.stdout`, `.stderr`, `.exit.json`. The retained `refresh.mjs` reproduces this scoped runner approach. All artifacts are confined to this fresh /tmp directory.
