# T1 authority completion — activation HOLD

ROOT's 2100s prospective profile is recorded, not an actual grant. Independent review **6f9632cc2e51987f3fdfdb9eae2718e1977dc2d6**, receipt **04ef22c058ba46eca71c93ceab787fdebf474cbd55296d5573035bf3eee41743**, is authenticated from that commit. Preseal **774bf573b** precedes this phase's one six-control execution.

## Exhaustive actual supervisor closure

| Source-bound importer | Exact builtin specifiers | Relative imports |
| --- | --- | --- |
| supervisor.mjs | node:fs, node:crypto, node:url, node:path, node:zlib | ./data-support.mjs, ./owned-process.mjs, ./receipt-gate.mjs |
| data-support.mjs | node:fs, node:crypto, node:path, node:zlib | none |
| owned-process.mjs | node:child_process, node:fs | ./data-support.mjs |
| receipt-gate.mjs | node:util | ./data-support.mjs |

These **12 builtin + five relative edges** are the complete four-file supervisor dependency graph. All source hashes/bytes are in AUTHORITY-CLOSURE.json and match unchanged r3 execution-preseal inputs. They require exact ROOT authority; this is not a global builtin allowlist. No materializer, preparation controller or old control module is reachable from this graph. Their separately listed source reads are NOT activation authority. Existing 135 per-case maps/CASE hashes and inventory remain bound, not silently widened.

A03 now has ROOT-approved source-bound six bootstrap imports: node:worker_threads, node:fs, node:crypto, node:module, node:url, node:path. Fixed nine-module graph and limits→node:timers/promises, validation→node:util, actual-entry→node:worker_threads are preserved. Requested env{}, execArgv[], operation/version unchanged; only effective bootstrap URL/argv/execArgv/environment KEY NAMES/selected workerData fields are proposed observations. No full environment values, stock identity or non-A03 nested trace claim.

## Concrete blocking decision

Frozen data-support.mjs:14 admits exactly schema/authorized/profileSha256/runId/cases/Workers/wallMilliseconds/knownOS/captureBytes/workingBytes. It has **no latest-start/expiry fields**. C06 actually imports only that pure helper: the 2100000ms ten-field DATA record passes; adding latestStart/expires rejects; original 1800000ms rejects. Therefore I did not invent/change a schema or substitute an unchecked outer time window.

**ROOT decision requested:** authorize narrowly versioned typed window admission, or identify the exact already-approved validator. Target offsets remain latest start +20min and expiry +55min from fresh grant issuance; no stale dates minted during preparation. SLOT.json seals the current command/argv/env/profile and a DATA-only grant template, with final grant digest deliberately PENDING. An immutable executable grant cannot honestly be completed until this schema choice is resolved. No ROOT-GRANT.json or actual dispatch was created.

## Results, slots, qualifications

Six closure DATA controls **6/6**, one controller exit0/empty stderr, zero child fixtures/Workers/product/compiler. A second pure helper is reserved solely for immutable file-based publication census, not another control cohort. Controls reject missing/extra edges and hash drift, authenticate A03 +135 case bindings, and preserve the schema HOLD. No production or existing harness source changed.

Prospective actual remains **146 known OS** (owner1 +135 cases +10 administration), peak3; **111 Workers**, peak1; 64MiB capture/256MiB work; 2100s inclusive observation/admission/publication; case10s/TERM2s/observe1s/publication180s. One measured final-publication slot is reserved WITHIN administration10, not added. Unknown retirement stays STOP_UNKNOWN with ownership retained; finite observation is not guaranteed OS quiescence. No actual slot has been spent.

47 eligible/135 cells remain unexecuted; six nonpublic and seven public deferred obligations remain gates. **All60 variants UNRUN**. C2, F01, old1800 proposal, independent original failures and all prior history remain unchanged. Different review + fresh actual ROOT GO are still required.

## Artifact SHA256

- AUTHORITY-CLOSURE.json (4876 bytes): 1ebcca468acfbc46c2db16f53a020bde04d417e6aee31a8e20fe15e23373d08f
- SLOT.json (3575 bytes): d42b31a9e03a53ecd9f201a8ad54cf12f7ea2c0b9c8c1c1805f24a3020887ee5
- PRESEAL.json (1698 bytes): 470c4097f1829abda5c6d822a3f4722de7cf35a713aaee661957706c5863d1dc
- RESULT.json (723 bytes): f4c265d7064139d32fb28606c7ca6f52c775699b264ba987b4eb048bd3d53507
- closure-check.mjs (4504 bytes): 4d6a4b5ed6ccd4a0ea0de17a167dcad1d2a4ead34e1f124c5bcead0cc86e390b

PUBLICATION.json records bounded file/capture snapshot and elapsed time; final commit captures necessarily trail that snapshot. Tool receipts distinguish observed completed direct processes from unobserved universal OS census.
