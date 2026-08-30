# L02 / diagnostic continuation readiness — different review

Date: 2026-08-28. **READY for the exact10-Worker/9-guest continuation, subject to ROOT's fresh one-shot grant and explicit approval of the new parent-only edge.** No additional source repair identified. This is readiness, not Worker/guest acceptance or completed K1–K4 proof.

## Frozen inputs

Source 1afe801c1ce898b44ae202a63dfab81946958a59; evidence f4212f96b4c15c53519a5d617cf06142976c0cae. Reviewer preseal 63c9ab19b0562d2d0f8ee64f31f11b69e76f8c64; control admission89c4fca48bd8cf1662f6306ac55708a6e9440e34. Guard 9adf0df59fa497e73c9eb2c6e70454d548400526.

Profile 61d005bfce187fc80aa9f827359d25141269ee2c10ec0066f048ecd65dc856da; continuation preseal 058965bf4c3fdc56d6921037d836ac581b7ca9ba69157020a0288e185cb1cf72; composition 5e611bd8d1748944ff105ec9837388ccba788ac41cb543bb379e25b433d9a286; MODULES 8b5b6b83e650b6354fe276b2247ef51e7eefe562405680dc40b5f202fefc9255.

Independently authenticated125 capsule entries/1,323,686 bytes,117 module records/303 edges/93 reachable engine modules. All module/importer hashes and local targets bind the frozen capsule. No moving-HEAD fallback.95 JavaScript emissions/1,076,164 bytes independently match publication463a945125b900cbb98436b9e9292d78ca6c98aa by hash and Git blob identity. The96th compiled-directory entry is package.json, not code emission. PUBLIC98 lineage reuses accepted publication; no fresh fetch/compiler/strict typecheck.

## Exact authority request

Only new builtin importer/specifier pair relative to authenticated v6 MODULES: **diagnostic-publication.mjs → node:util**, parent-only, importer SHA256 7fd093905541561d6112b13f7ac224dec43caaaed6bfcb2124294ac3b88baa07. It uses types.isProxy/types.isNativeError. ROOT must authorize this exact edge; inclusion in candidate manifests is not authorization. No guest fs/process/SAB/ports/global builtin grant. REVIEW.data.json enumerates all existing and new edges.

## Guard / L01

Exact textual comparison proves the sole guard-expression delta is key !== 'stack' around the data-descriptor requirement. Stack is never read/transported. Unknown/symbol keys and accessors on transported fields retain strict rejection with the original reason; origin recognition,28 FS codes, bounded strings and optional fields are unchanged. Diagnostics reject Proxy before descriptors; typedErrorDTO is not thereby a universal malicious-host Proxy-safe API. L01 successful RPC routing does not enter typedErrorDTO: no source-visible success-path weakening identified, but L01 is NOT rerun/rescored on v10.

## Diagnostics / current owner / judge

Supervisor returns the same per-case Reservations object used for publication. One MiB is reserved before inspection/observation/encoding, max4 raw records/8192 serialized bytes. Fixed own-descriptor fields and vocabulary-limited redactions avoid copying arbitrary message/stack/cause contents. Accessors/Proxy traps are not invoked by this diagnostic path. Raw array/reason identity and publication faults, including thrown undefined, remain separate live references. Judge uses original references before serialization. Release failure prevents complete=true even after successful write; partial files are not rolled back or called atomic.

Receipt/judgement schemas are fixed trusted producer data, each bounded65536 bytes; aggregate1MiB charged before file writes. receipt.reservationPeak is sampled BEFORE diagnostics, not a full-publication peak measurement. The same16MiB ledger remains enforced, not RSS/whole-guest allocation. Whole-parent/native-file publication remains SOURCE-only; harmless controls inject writers.

Current future-owner e944eaac0de22016f61446b32d94654510b3a8c04c47d7a5a42813c976b5c7d2 uses repaired v7 capture-owner 1cbec42dfb24de259c515e5686faa3aff8a5cb17171689831fa3b3360a9fe104: capture registration before launch, partial-acquisition cleanup, independent close attempts, bounded short-write handling, actual primary/secondary reasons separately retained. Outer source uses TERM then2-second KILL and waits for close; natural control exits do NOT qualify this timeout branch. Census includes existing/new capsule entries, bounded220 files/32MiB; artifacts retained, cleanClaim=false. Judge requires actual Worker exit AND settled parent cleanup, distinguishes deliberate cleanup failure, reconciles terminal/ACK/delivery, and rejects normal L08 completion instead of actual OOM. Missing guest evidence is not a reason to block this observation; it is required to claim its results.

## Actual harmless results

- Original23 guard controls **NOT EXECUTED**: reviewer Node launch failed before module load, ERR_ACCESS_DENIED resource /tmp because its symlink spelling was used. Raw stderr/status1 retained, not23 product failures/pass. No guard retry. Author23 remains separately attributed.
- Original20 publication controls **20/20 PASS**:4 actual helper loads matched hashes plus entry self-authentication. Second admitted child used canonical /private/tmp with unchanged closure-only read grant; no permission widening. Both JSON records/raw stderr retained.
- Both children naturally exited/closed. Capture handles closed; both temporary trees removed. Zero Workers/guests/engine imports/compiled-FsError probes/compiler/private/network.
- Review preparation errors retained: BINDINGS initially sought in source rather than evidence; unavailable REPL process before spawn; compiled-prefix count96 corrected to95 .js emissions; report assembly mistakenly accessed .bytes on an already-Buffer source, corrected without execution. These are reviewer corrections, not candidate source changes.

## Exact continuation / history

Order: L02v2,L03,L04,L05(undefined),L05(false),L05(object),L06a,L06b,L07,L08.10 distinct Worker slots/9 guest entries, peak1; L08 zero engine evaluations; NO L01. Case admission5s/cumulative120s; outer180s plus2-second termination grace. Caller/control/cleanup outcomes and intentionally unclean L06b stay distinct from numeric success.

Preserve345b9851: L01 PASS/L02 FAIL with detail absent,2Workers/2guests,9/8unrun. Separate probe4d7f8531 establishes an own-stack-accessor mechanism on that observation, NOT retrospective exact original L02 cause. Old96vs95 metadata mistake/all actual HOLDs unchanged. K1–K4 partial; L lifetime retirement is not all-jobs-settled. This review adds no actual guest result.

## Reproduction / resources

REVIEW.data.json holds full candidate hashes/capsule inventory/publication bindings/builtin edges/raw control streams/actual loader receipts and executed reviewer function bodies. Node22.22.2 /Users/kjopek/.nvm/versions/node/v22.22.2/bin/node:112,989,184 bytes, SHA256 5c899797c4eb8f1db5563eea56538342ddb3e9276ee1b04a5a1f0f1023d2b011, streamed pre/post unchanged; never decoded. Two harmless Node children only. Git/patch also counted: final patch/add/commit/status fit24 total conservative OS slots, peak2. Tracked bulk work228,669,872 bytes plus16MiB conservative source/report reserve stays below256MiB; capture below64MiB. Final elapsed is recorded in commit handoff, bounded15minutes. All owned children closed; task-owned temporary files removed. No product/author/foreign staging edits, whole Git archive or AGENTS copies.
