# Authorized v3 representative execution

**2026-08-27: one authorized attempt completed; author post-run checks pass. Final independent review remains pending.** All eight observations reproduce the old baseline's exact four-field observations. This is not eight native passes: four known native failures remain failures.

This later document is additive. `REPORT.md`, the original offline evidence, rejected/prior candidates, preflight history, `DRIVER-FIX.md` and all earlier seals remain unchanged. Their earlier statements that execution had not occurred remain historical statements, not rewritten runtime claims.

## Authorization and actual execution

Root approval `/tmp/safe-bash-baseline-auth-approval-v3.json` SHA256 `40d096afcb54a38a3fab58ea16ba550350917ce81f80765c07a7c9068b7f0938` matches the ten reviewed input hashes and text-plan hash. The author template remains `approved:false`. Reviewed candidate manifest SHA256 is `3fbc048049654a3bc2698fe09365bd91879af06f4a3f5f8e5485dd08a0c40888`.

The exact sealed `env -i` supervisor command ran **once**, with a shell `exec` prefix only to replace the tool's launch shell. Tool exit was0, with empty terminal stdout/stderr. A stale patch-tool path initially prevented publication of the read-only authorization receipt; no supervisor had started. The repeated metadata/hash check and that receipt-publication error are retained in `execution-approval-check-v3.json`; they are not benchmark attempts or retries.

Managed processes: supervisor PID80129, coordinator PID80445, and eight sequential engine PIDs80554,80567,80581,80600,80630,80657,80701,80735. The journal records maximum one simultaneous engine: supervisor+coordinator+engine gives maximum three managed concurrent processes, ten managed Node processes total. Eight ready events, send API calls, successful send callbacks, request settlements and timely observations are recorded. No warmup, initialization-only, neutrality, transport/control, inventory, retry, native, full224 or extra product request was run. Fixture construction and the one Bash instance per requested observation remain the frozen recipe setup.

Loopback opened at `2026-08-27T06:41:59.090Z`; its close was recorded at `2026-08-27T06:42:01.272Z`. Supervisor completion was `2026-08-27T06:42:01.530Z`. These are lifecycle timestamps, not performance results.

## Exact observations

Each row uses the unchanged v3 recipe hash/native expectation/old observation from the reviewed plan. Both the frozen comparator and a separate builtin-only post-run check compare JSON representations of **stdout, stderr, exitCode and VFS entries** exactly; no assertion is relaxed.

| Sequence | Profile | Existing recipe ID | Old four fields | Native result / failing fields |
| --- | --- | --- | --- | --- |
| 1 | original | `command/echo/multiple` | match | PASS |
| 2 | original | `composition/archive-hash/archive-hash` | match | PASS |
| 3 | original | `command/cat/binary-stdin` | match | FAIL stdout |
| 4 | original | `network/curl/get` | match | FAIL stdout |
| 5 | original | `network/curl/output` | match | PASS |
| 6 | original | `kernel/type/type` | match | PASS |
| 7 | original | `command/patch/dry-run` | match | FAIL stderr,exitCode,entries |
| 8 | scratch-aligned | `command/patch/dry-run` | match | FAIL stderr,exitCode |

Thus8 observations concern7 IDs, not8 distinct recipes. The two patch rows retain their different profile expectations and the original entries failure; they are not merged. Raw responses, comparison assertions, base64 output, namespace effects, registry records and lifecycle results remain in `representative-v3-attempt-001/result-1.json` through `result-8.json`. The raw responses also appear in the event journal before cleanup.

## Runtime identity and no substituted command body

All eight loader traces resolve the profile's explicit `baselineRoot/dist/bundle/index.js` import to the authenticated copied package, record its load attempt and returned module load, and subsequently record engine ready. Bundle SHA256 is `70dd1320d921b736e965b1545e50ab57af2b2807a26de7fa624d4f519a953b7c`. The frozen engine emits ready only after its awaited entry import completes; this supplies bounded successful entry-import evidence, not universal evaluation of every module or asset. The engine selects this bundle directly; this is not a claim that every package export/entrypoint was exercised.

Post-run fresh file reads independently reproduce **all3844 closure files**: the original3842 plus only the two approved observer additions. There are no missing, added or changed file paths; all are independent regular files with the sealed sizes, bytes and modes. **All955 package files /22,583,023 bytes** match the authenticated published per-file map exactly, including package manifest SHA256 `b49c28900fe0640b12b9f9e9bb45feebbfa1e94b1a03b0ba7e076a0cb548f3fd`. Every observed file-module load hash also matches the freshly rehashed closure. This links the accepted official tarball evidence to the actually used bundle for this bounded run, without retroactively manufacturing historical runtime traces.

Both exact frozen engine files still match their reviewed hashes: original `0d534d17f3eb930c12f10d11df551ea31ec79ca4ce495e53bba91ab3abf95b39`, scratch-aligned `c6744398ee47d8ba6e975deae2b694e4e9c641d400166ac639cf797b0b623323`. Their Bash constructor receives no custom command definitions. Existing command-map entries are wrapped under the same name only to record argv and return the original `definition.execute(...args)`; no alternate command body is supplied. The baseline branch is selected, not the virtual-bash branch containing an empty-script initialization.

Actual wrapper events cover echo; mkdir/tar/tar/sha256sum for the archive pipeline/VFS recipe; cat; and the two curl calls. Kernel type and missing patch produce no registry-wrapper events; their raw observations still remain in the table, not misreported as registered-command coverage. Complete source line references, per-child load receipts and argv are in `execution-post-run-check-attempt-1.json`. These byte/control-flow observations support no locally modified/stub package or injected command shadow in these measured paths, not a universal inventory/semantic proof.

The2887 other base closure files remain frozen-tree equal, not individually npm-publication-authenticated by the just-bash tarball. The previously retained lock graph/tree evidence remains separate. Node on-disk SHA256 remains `5c899797c4eb8f1db5563eea56538342ddb3e9276ee1b04a5a1f0f1023d2b011`; supervisor/coordinator binding records and each engine's startup argv agree with the selected executable. This does not measure in-memory executable pages.

## Lifecycle and telemetry limits

All eight engines settled, received routine parent IPC disconnect and exited naturally with code0. There were **zero timeout settlements, failed send callbacks, late observations, cleanup signals, observer-reported forbidden-process attempts or recorded lifecycle errors**. The coordinator closed its loopback server and pipes; the supervisor reported its owned process group gone. No extra post-run `ps`, kill, socket probe or network control was performed.

The server retained exactly two unauthenticated `GET /bytes` requests at `http://127.0.0.1:52610`, corresponding to the two sequential approved curl recipes. Server records lack PID/timestamps per request; that attribution uses the approved sequence and curl registry argv, not additional connection telemetry. No external-service request was introduced by the harness. Loader hooks and forbidden-child-process hooks are not an all-thread, native-addon, syscall, asset-read or universal network/process census; process totals describe managed processes. The observer's child-process denial remains a disclosed host restriction, not transparent universal tracing.

Unchanged frozen responses contain `executeMs` and memory sampling fields. They are retained as raw incidental telemetry, with no new trial series, aggregation, performance experiment or superiority claim. No assertion of package-wide evaluation, universal cleanup or current full-cohort correctness follows from this subset.

## Evidence and next boundary

`representative-v3-attempt-001/` retains26 raw files,954,710 bytes, including stdout/stderr within raw observations, all loader and process/IPC journals, comparisons, loopback requests and supervisor/coordinator summaries. Host stdout/stderr chunks were absent (`hostBytes:0`); no synthetic empty chunk files are manufactured. `execution-post-run-check.mjs` is a builtin-only, no-product/no-network/no-process-control checker; its single successful check, full fresh3844-file map and process receipt are retained separately. The checked output SHA256 is `47c3fed832381c527ef1281a13e2c9731820438e18a2685ec6efe3f43ebecee6`.

`execution-v3-receipt.json` summarizes this attempt; `execution-v3-manifest.json` seals the additive documents and raw files. `/tmp/safe-bash-baseline-auth-replay-detail.txt` is the root/reviewer handoff. Earlier offline/report/preflight/seal files are preserved, approved inputs/token are unchanged, and no files in `verification/**`, production, original harness/goldens, old14 whitespace patches or main dependencies were edited. No staging or commit.

Historical scores remain **original222/224 and aligned223/224 ours versus baseline155/224**, on the dirty freeze `c2902a6` plus dirty/untracked SHA256 `76deb591783ac168ca5daef04c4351d7e80b159c003cd27d3a445190ca6fd74c`. There is no denominator union or136-outcomes-as-recipes addition. Baseline-only coverage stays separate. Mandatory current-score/lifecycle qualification and final acceptance belong to the independent reviewer/root; stop here without further execution or follow-up scope.
