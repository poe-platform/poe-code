# Independent final actual-results review — 2026-08-27

**GO to seal these exact comparison results, with failures and qualifications retained.** No integrity, missing-record, predicate-recomputation, or table-binding blocker was found. This is acceptance of the recorded comparison, NOT product-wide approval, release/global green, superiority, or performance evidence. No product/oracle execution or commit was performed by this reviewer.

## Exact run and evidence

- Candidate: `e33974b8c643077453227a9679d8ceca8367998c`; tree `f559246f1317af7691de00333e13dfc8f44ef428`.
- Announced ROOT receipt remains `c0f9468f33d1df5ec468bc98830c06fc8fcadb797f3595b0a7fa18f346f607a5`; binding remains `1c74655402eba80a12e1c190fa43ba6923faace8a7db81c7f17da8a3b4528b1e`.
- Source archive `903784b4a5b1123d285e81fff65883b44d486759fb5ce3f4d28c602ed66736cf`; candidate package `bc4f0e01d9daba5dc7c99a7d66615e52808a83a162140d59e88544c7c71fbd51`. Selected baseline is published just-bash 3.4.2, not a claim about the latest baseline.
- The authorized command ran once after ROOT's announcement. Driver PID/PGID 84951, wrapper 84948; launch `2026-08-27T12:53:46.913Z`, exit/close 0/null at `2026-08-27T12:57:49.382Z`. These are custody/lifecycle timestamps, not a performance comparison. Exact command matches frozen `NEXT_COMMAND.txt:2`; launch/after hashes and bounded driver captures match.
- Raw root: `/private/tmp/safe-bash-measurement-freeze-XAFOrN/measurement-attempt-001`. All **2,071 files / 432,565,451 bytes** independently hashed against `RAW_MANIFEST.json`, SHA256 `5c15aa518743449029f975b3e133544ede2f9ff6df9ed734bb8f9a1d575f9ba1`.
- Durable archive: `../measurement/raw-attempt-001.tar.gz`, **25,956,442 bytes**, SHA256 `9e2d3c24c709e7b5cd9ca6a7a8022e13f1e97c58ca235587562b5354cdf5932a`. Independent read-only archive inspection matches every regular member to the reviewed raw manifest; no duplicate, extra, missing, link, or traversal member. No extraction or product execution.

## Three separate reviewed tables

Original captured-golden profile: exact JSON equality of stdout, stderr, exitCode, and entries, without oracle edits or normalization.

| Engine | Matches / 224 | Mismatches | Lifecycle failures |
| --- | ---: | ---: | ---: |
| virtual-bash | 222 | 2 | 0 |
| just-bash 3.4.2 | 155 | 69 | 0 |

Aligned captured-golden profile: its separately frozen captures and explicit `/tmp` setup; not a pooled or corrected replacement for original evidence.

| Engine | Matches / 224 | Mismatches | Lifecycle failures |
| --- | ---: | ---: | ---: |
| virtual-bash | 223 | 1 | 0 |
| just-bash 3.4.2 | 155 | 69 | 0 |

Breadth: declared-intent predicates, NOT native goldens. Operational credit requires the declared functional-positive classification and clean lifecycle. Diagnostics remain unscored.

| Partition | Engine | Outcomes | Raw intent matches | Operational credit | Lifecycle failures |
| --- | --- | ---: | ---: | ---: | ---: |
| Targets | virtual-bash | 54 | 13 | 13 | 0 |
| Targets | just-bash 3.4.2 | 54 | 50 | 47 | 1 |
| Controls | virtual-bash | 7 | 7 | 7 | 0 |
| Controls | just-bash 3.4.2 | 7 | 6 | 6 | 0 |
| Diagnostics | virtual-bash | 7 | — | Unscored | 0 |
| Diagnostics | just-bash 3.4.2 | 7 | — | Unscored | 0 |

No union, additive score, cross-profile deduplication, or speed ranking. The 1,032 observations include 14 unscored diagnostics. The bridge's `scoredCase` counter means one selected execution admission, not scoring permission for those diagnostics. Its 448 empty candidate initialization calls are separately recorded setup, not extra observations.

Machine tables: `final-attempt-004-original-table.json`, `final-attempt-004-aligned-table.json`, `final-attempt-004-breadth-table.json`. Each row retains exact IDs/engine/profile, recipe and raw-evidence hashes, raw channels/status, failed fields or intent checks, lifecycle classification, and VFS evidence/effects. Their SHA256 values are in `FINAL_REVIEW_RECEIPT.json`.

## Concrete failures for authors

- Candidate original `command/patch/dry-run`, `attempt-0292.json`: only entries differ. Historical native capture includes fixture-relative `tmp`; actual candidate preserves `input=old\n` and the patch file without that directory. Aligned `attempt-0740.json` matches its separately frozen capture. Preserve the original mismatch as a scratch/harness-profile issue; do not create fake product directory effects or retroactively rewrite the oracle.
- Candidate `kernel/type/type`, original `attempt-0364.json` and aligned `attempt-0812.json`: stdout is `command\ncommand\nfunction\n`, capture expects `builtin\nfile\nfunction\n`. Status/stderr/VFS match. This is a registry/native classification difference, not authorization to mislabel registry commands as builtins.
- Baseline **69 mismatches in each expanded profile** remain exact failed-field records, including terminal-byte, options/status, and VFS-effect differences. Every ID and evidence filename is listed in `final-attempt-004-failure-groups.json`; no broad product-fault attribution follows from historical predicates alone.
- Candidate breadth targets: 33 missing-handler; four dependency-blocked (`compopt-positive`, `dirs-positive`, `popd-positive`, `unalias-positive`); two syntax-blocked (`mapfile-positive`, `readarray-positive`); `tree-positive` partial; `wait-positive` no-op without operational proof. All 33 missing IDs, including the four additional optional commands, are listed in the failure-group evidence. No fake SafeJS/runtime injection is credited.
- Baseline breadth nonpositive targets: `compopt-positive` misses declared stdout terms; `exec-positive` leaves forbidden `after-exec`; `tree-positive` differs in stdout; `help-positive` is documentation-only; `wait-positive` no-op; `node-positive` baseline stub; `js-exec-positive` lifecycle failure. Help/wait/JS explain why 50 raw intent matches yield only 47 operational credits.
- Baseline control `terminal-byte-control`, `attempt-0900.json`: status 0 but stdout AND VFS file bytes differ. `/fixture/bytes` is `AH/CgMO/` versus required `AH+A/w==`; candidate `attempt-0899.json` preserves the latter. This particular failure is not merely a terminal-display assertion.
- Both-failed is NOT parity: original `command/patch/dry-run`; breadth `compopt-positive`, `exec-positive`, `help-positive`, `tree-positive`, `wait-positive`, `js-exec-positive`, `node-positive`. Neither tree output matches its declared expected bytes, and the two actual footer counts differ. No tree/new-holdout investigation or expectation rewrite was added.

## Lifecycle, imports, source, and fairness

All 1,032 planned profile/engine/ID/recipe records exist exactly once: original 448, aligned 448, breadth 136. Zero missing, duplicate, not-run, invalid-marked native captures, malformed/rejected frames, setup/census capture errors, recorded execution exceptions, or reported dispose errors. Predicate differences remain distinct from harness/capture errors. All journals match their corresponding attempt event arrays. Reconstructed complete frame streams match all 1,032 recorded wire hashes/prefixes/lengths (179,429,387 framed bytes); original wire prefixes remain labeled prefixes, not silently promoted to original full-stream files.

**One lifecycle failure remains FAIL:** baseline `js-exec-positive`, `attempt-1006.json`, coordinator/PGID 91258, engine 91259. It returns `42\n`, empty stderr, status 0, and matching declared VFS intent, then exceeds the 10-second post-result natural-exit allowance. SIGTERM is sent once; no SIGKILL. Coordinator exit/close records SIGTERM; engine exit/close and fixture/session completion are unobserved. All five original failure strings remain, including `unverified pipe/fixture/group closure`. Later group disappearance does NOT make this clean or functional credit. This is not a guest deadline, spontaneous crash, malformed/oversize result, or retry. Its worker/handle cause is not determined by the evidence.

Fresh read-only OS checks find all **1,032 managed groups and 2,064 distinct coordinator/engine PIDs**, plus wrapper/driver, absent. There are 1,031 naturally clean attempt records. All **34 actual loopback network fixtures** explicitly record closed with zero sockets and no fixture error. The failing JS case was non-network; its missing pipe/session closure acknowledgment stays failed. No universal detached-descendant, worker-evaluation, or RSS-bound claim is made.

Both packages have **516 actual public resolutions and entry-import-fulfilled events each** from their moved offline roots. Candidate public entry SHA256 `77b771a6066aa32f82b903f7a80c578132388d6d9cec9fbde15485915859df5d`; baseline entry `70dd1320d921b736e965b1545e50ab57af2b2807a26de7fa624d4f519a953b7c`. All 102,698 recorded loader returns across 393 identities match bound files. This is root-import and loader-return evidence, not proof that every returned module, worker, CJS dependency, or asset was evaluated.

Fresh actual-byte checks match pre-run binding and raw post-membership for all 15 runner files, 711 candidate-closure files, and 3,844 baseline-closure files; exact package membership has no extra files or symlinks. All 220 selected source inputs, source/package/baseline archives, source inventory, Node, 15 committed cohort files, and old seals match. The moving checkout was `ac816c677d4c76f4be674b8b11ad4a10618638a9`, not the product source consumed. Executor summary/import/cleanup/source receipts reconcile with raw rather than serving as the sole evidence.

Literal recipes, stdin, fixture data, expected captures, per-profile IDs/order, and breadth configuration maps match sealed inputs. Raw admission events retain the scrubbed bound host environment/cwd, selected Node, and 256 MiB V8 heap flags; these are not whole-process RSS caps. Recorded totals remain expanded 28s with 5s guest allowance; breadth 50s/140s with 30s/120s guest allowance. No cap extension or deadline reset was found. Original TMPDIR is omitted; aligned explicitly creates `/tmp`. Baseline stdout uses the public byte-conversion API; baseline stderr remains UTF-8 derived from public text. Actual raw and projected output channels happen to coincide in this run. VFS byte effects remain distinct from terminal representation. Dispatch is explicitly **not instrumented**; no claim of actual unshadowed-dispatch tracing is made.

## Preserved qualification and reproducibility

`ANNOUNCED_RECEIPT_QUALIFICATION_UPDATE.md` and its hash proof remain unchanged. ROOT's matching-blob env source/v2 qualification supersedes the receipt's creation-time unresolved wording only in that scope. Complementary env counts are NOT inserted into these tables/goldens or pooled. env-S remains partial, shebang/kernel profile losses and native diagnostic differences remain; other fixture-validity limitations are not silently resolved. No fresh native tools, new 24/treefile cohorts, release gate, or whole-gate cleanup is required to seal this comparison.

Executable read-only recheck: `node benchmarks/reports/current-comparison-20260827/measurement-review/review-results.mjs review-recheck-005` (use a new lowercase/digit/hyphen prefix if that one is already present; writes only new reviewer evidence). Archive check: `/usr/bin/python3 -I -B benchmarks/reports/current-comparison-20260827/measurement-review/review-archive.py`. Neither imports product modules nor invokes native oracles. Final successful check is attempt 004; archive check 001 also passes. Attempt 002 already reproduced the same tables; the later check adds explicit caps/admission/launch assertions, not a product retry.

Reviewer failures are retained: attempt 001's 4 MiB Git-output cap stopped on the large committed overlap artifact (Git PID 14357, SIGTERM, now absent); the verifier switched to exact Git blob-ID comparison instead of copying large Git stdout. Attempt 003's strict floating-point comparison rejected `27999.999999999996` versus `28000`; the check now uses the same millisecond precision as the recorded deadline summary. No product cap, predicate, oracle, or raw record changed. Original stderr logs and producer archive-verifier failure remain preserved. Final scripts and all successful/failed review evidence are hash-bound in the final receipt.

Only measurement-review artifacts were written. Prior freeze/bridge/env review evidence is preserved; no other owner's source, staging, freeze, raw result, or archive was changed. No commits. Remaining work is ROOT's coordinated result seal/commit authorization; product defect triage and any broader gate are separate tasks. This reviewer stops here, with all its command sessions closed.
