# B1–B3 corrected candidate, v3

2026-08-27. **NOT APPROVED; representative execution has not run.** This is an author correction for independent review, not independent acceptance. Accepted offline package authentication remains PASS955/955. No published bytes, recipes, goldens, old raw evidence or old report have been edited.

## B1 — complete launch binding

`launch-seal.mjs` requires root hashes for ten consumed inputs, including `download.json`, both driver helpers, the external supervisor, both unchanged observers, v3 plan, closure map and package comparison. The separate text plan is also hash-bound. Supervisor and coordinator check the selected Node path and actual `process.execPath` on-disk SHA256 against the Node hash in bound `download.json`. The observed current Node hash remains `5c899797c4eb8f1db5563eea56538342ddb3e9276ee1b04a5a1f0f1023d2b011`. This is an executable-file identity check, not a measurement of in-memory executable pages.

Observers are staged from captured approved buffers, not reread mutable source paths, and staged hashes must equal root-approved hashes. Only `auth-observer/observe-process.mjs` and `auth-observer/observe-load.mjs`, independent regular files mode0444, may be added. Full membership, file bytes, byte sizes and modes are checked; links, special files, duplicate/missing/extra files and undeclared directories are rejected. The sealed base3842 files become exactly3844 with these two additions. The unchanged observers are explicit host restrictions/loader observers, not command stubs or universal thread/evaluation tracing.

## B2 — bounded finalization, errors retained

`supervise-representative.mjs` adds one external owned supervisor around one detached coordinator process group. Eight sequential engine children inherit that owned group. No supervisor package/recipe call is added. Complete planned budget:8 observations,7 IDs,8 engine children,1 coordinator,1 supervisor;10 total Node processes, at most3 concurrent. Early failure stops the remaining selections rather than inventing eight results.

The supervisor installs146s TERM/148s KILL/150s final-publication timers after its initial approval/hash gate and before closure validation/coordinator launch. It remains alive through coordinator cleanup, pipe closure and owned-group checks. It retains a separate summary even if coordinator finalization never returns; missing coordinator data or a surviving/unconfirmed group is failure, not successful cleanup. This is bounded normal OS/event-loop operation, not a hard-real-time guarantee against host suspension/filesystem failure or a universal descendant census.

Coordinator soft abort is140s; startup15s/request10s remain. Routine compatible cleanup is **parent IPC disconnect**, then up to2s natural zero exit. SIGTERM2s and SIGKILL2s are exceptional escalation, always failure. Cleanup errors cannot skip the separately attempted network evidence, bounded server close, closure check and summary. A late-opening server has a memoized bounded close; external supervision contains a still-open coordinator. Output/observer/write/timeout/nonzero-exit failures remain visible and stop the subset. No synthetic stop/control request is sent.

## B3 — terminal fences and actual event accounting

Startup/request timeout, error, explicit closing and abort move the transport into a terminal/closing state. Late ready messages cannot dispatch, including an abort during dispatch-intent publication. Late raw responses are retained but cannot resettle or become timely observations.

Counts come from journal events, independently of returned `run` results: launch attempt versus actual `spawn`, dispatch intent versus actual IPC API invocation, return/throw/callback, startup settlement, request settlement, timely observation and late ignored observation. `child.send` being called or flushed does not prove guest execution. Raw timely responses are journaled before comparison/cleanup. The supervisor reconstructs retained journal counts if the coordinator summary is absent; partial counts are lower bounds, not zero work. Request rows retain unlaunched/unsettled/unknown state.

## Narrow checks and limits

- `driver-fix-checks-attempt-2.json`: seven syntax checks pass; eight non-product helper cases pass, using eight fake EventEmitter child fixtures/manual clocks and one2ms finalization timeout. They cover successful settlement, both timeout fences, child error, explicit closing/reentrant abort, callback/throw accounting, bound hashes/exact additions, and cleanup-error/close-timeout continuation. No real helper children, server, filesystem fixture or package import inside these checks.
- `driver-fix-checks-attempt-3.json`: final supervisor/coordinator syntax checks pass after source-only launch-publication and duplicate-cleanup guards. No helper rerun.
- Attempt1's evidence-publication wrapper could not find `apply_patch` in its isolated PATH. Its seven syntax-check processes and one helper-check process had returned, but individual output/status was not retained. `driver-fix-checks-attempt-1-publication-error.json` records this; it is not counted as a pass. A source-inspected `ok`/`success` helper-field mismatch was fixed before retained attempt2. Two earlier patch-format rejections changed no files.
- Total in this correction:16 syntax-check child processes and2 non-product helper-check child processes across attempts; zero representative/product/native/performance/224/download/install/control calls. Builtin-only authoring/hash/evidence wrappers and patch commands are not product runs. No supervisor/IPC/process-group/server behavior has been executed against an OS child; the independent reviewer must review this source before root decides whether to authorize it.

## Preserved history and handoff

`prior-candidate-v2/preservation.json` seals nine named byte-exact prior copies: rejected driver, both observers, v2 plan, original handoff seal, original report, old text plan and both preflight documents. Rejected driver SHA256 is `f7d3ed67e685a2e89e6daf5d5920cf36b5f3dd030b8998489264109983ab75ce`. Original `representative-plan.json`, `representative-plan-v2.json`, `handoff-manifest.json`, `REPORT.md` and raw artifacts remain in place unchanged. Reviewer-owned `verification/**` is untouched. `driver-fix-validation.json` records preservation/hash/row checks; `driver-fix-manifest.json` seals the current candidate and exact approval inputs. `approval-template-v3.json` deliberately contains `approved:false`; only root may create a separate true approval after review.

Exact seven IDs/eight profile rows, recipes, comparator/native expectations and old baseline outcomes are carried unchanged to v3. Old results are expectations, not new results. Original222/224 and aligned223/224 ours versus baseline155/224 remain historical dirty-freeze evidence (`c2902a6` plus dirty/untracked SHA256 `76deb591783ac168ca5daef04c4351d7e80b159c003cd27d3a445190ca6fd74c`). No denominator union, no136-outcomes-as-recipes addition, no new score/performance/superiority claim. Current-score/lifecycle qualification remains with the different leaf.

Root/reviewer entry point: `/tmp/safe-bash-baseline-auth-driver-fix-detail.txt`, then the manifest, this correction, and the unchanged prior preflight. The approved:false template and `/tmp/safe-bash-baseline-auth-plan.txt` are proposals only. No staging or commit performed.
