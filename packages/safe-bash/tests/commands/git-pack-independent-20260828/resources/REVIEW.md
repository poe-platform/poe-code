# Independent M1B Resource Review Specification

Status: Proposed — independent design review and author corrections, not ROOT ratification
Implemented Through: Not applicable
Purpose: Freeze a bounded resource, admission and ownership review without implementing or executing the pack reader.

Date: 2026-08-28. Reviewed author commit: `63d811bf1a809b467f47f309f41b1445486e71db`; design `7447166d3573eb6fa1ddcd6eb51b8e8212179033`; data tools `bacf99cb0f8c675c06c29703ff6060357957136f`. M1A `9885390fb11454fa194a3e60fdbef198dbfdf633` is frozen under its separate implementation reviewer. This review does not supersede that review or the author's original packet.

## Normative Language

MUST/MUST NOT describe evidence discipline in this review or explicitly identified proposed corrections. Recommendations are not accepted product defaults. D1/D2/D3 remain ROOT decisions. Future implementation obligations are UNRUN; source reasoning MUST NOT be converted to observable product proof.

## Problem Statement

The design has adequate high-level safety intent but needs two precise accounting/admission clarifications before its implementation contract is frozen. Its 24 ceilings are simultaneous and strongly mask one another. A successful tiny DATA parser cannot demonstrate fixed-budget feasibility, cooperative cancellation, resident ownership or query usefulness. The design's strict eager admission is materially stronger than ordinary selected-object queries, while its inert sidecars are deliberately weaker than body-byte integrity guards.

## Goals and Non-Goals

Goals: exact limit dimensions; safe arithmetic before admission/allocation; lifetime-correct pinned cache; location-specific delta depth; shared invocation budgets; Node22 consumption/cleanup proof boundaries; finite source-versus-observable cases and explicit ROOT alternatives.

Non-goals: product changes, M1A implementation review, detailed binary-format/CRC/delta-parser review owned by the format peer, native Git qualification, benchmarks, new caps/overrides/leases/providers/config routes, retries, private engines, or YQ work. No target import, compiler, build, loader or product execution is authorized here.

## Findings and Minimal Corrections

**R01 — required accounting-dimension clarification.** Author SPEC.md:144 makes accounting globally cumulative, but resident release, independent sizes and intrinsic depth elsewhere in the same design are not cumulative counters. Replace the blanket scope with the exact dimension table in LIMIT-REVIEW.json (subject to author confirmation), retaining all 24 numbers. Distinguish physical pack occurrences from the deduplicated loose+pack OID census. State which repeated listings/table admissions spend maxEntries; do not recharge a cache-hit OID as a new unique object. Preserve maxChunks' current VFS-row scope unless an extension is explicitly declared. This is a design-text ambiguity, not an observed product failure.

**R02 — required sidecar observation clarification.** DECISIONS.md:8 permits lstat-only inert sidecars, while MATRIX.md:20 says “changed sidecar” without specifying the observation. Recommended correction: before/after complete membership, regular-kind, finite safe size and available stat-observation checks; body contents are unused and unverified. A same-observed-stat body change is not promised detectable. If ROOT instead requires body-byte immutability, specify bounded read/hash costs and their shared budgets; do not claim it is free because contents are semantically inert. No snapshot, lease or ABA guarantee follows from either choice.

**No additional product-code finding is issued.** The ownership, cooperative checkpoints and native-write barriers below are mandatory future implementation proofs, not falsely scored defects in nonexistent M1B code. The format peer's F01/F02 compatibility findings are separately attributed in PEER-NOTE.json; no independent reproduction or format acceptance is claimed here.

## ROOT Decisions

| Decision | Minimal recommendation | Alternative and required consequence |
| --- | --- | --- |
| D1 | Retain author's eager-all-pack-before-any-success rule only as an explicitly accepted strict integrity profile, including its budget costs. It is not full fsck because unselected loose bodies remain lazy. | If ordinary-query scope is preferred, freeze exactly which global envelopes/CRCs and which selected dependency bodies are verified. Rebind unselected/loose-shadowed corruption rows; no silent lazy optimization. |
| D2 | Accept only regular same-stem .rev/.bitmap/.keep/.mtimes with a complete pack/idx pair, plus objects/pack/multi-pack-index and objects/info/{packs,commit-graph}, with R02's explicit observation contract. | Refuse these entries until ROOT accepts the finite admission change. No new .promisor, MIDX-bitmap naming pattern, incremental directory, linked worktree, alternates, config, hook or network admission. |
| D3 | Pin verified body owners for one invocation; no eviction or public lease API. Release compressed pack owners sequentially only after their dependent work/views end. | Requiring eviction entails a separately designed private lifetime protocol. B10's original eviction clause remains unfulfilled/out-of-profile under no-eviction; it is not waived into a pass. |

Under D2 there are at most 35 allowlisted sidecars for eight complete pairs: four per pair plus three singleton paths. Their individual 16 MiB stat ceiling is not a 560 MiB read allowance. Listing names and observations still consume existing entry/work/resident accounting. Unknown or authority-bearing routes remain refused. Complete independent pack/idx enumeration, not the ignored MIDX or sidecar body, supplies object authority [G2/G3].

## Fixed Limits and Static Arithmetic

LIMIT-REVIEW.json records every unchanged literal, unit, dimension, seam and proof role. No arithmetic below is an execution result or a promise that an at-ceiling input succeeds.

1. For one pack of P bytes, proposed owned fill costs at least P copied bytes, pack SHA covers P-20, entry CRCs cover P-32, and pre-publication full-file hash covers P. Thus `W >= 4P-52`. At P=8,000,014, this is 32,000,004, already over 32,000,000 before idx, inflation, comparisons, object hashes, traversal or output. At P=8,000,013 the lower bound equals the cap; omitted positive work still prevents treating that value as a fit guarantee. This bound assumes the design charges each stated copy/hash/CRC operation, not one shared credit for unrelated work.
2. Eager admission plus mandatory pre-publication reread requires `R >= 2*sum(packBytes+idxBytes)` before other repository reads. One pack of 33,554,432 bytes plus the minimum 1,072-byte SHA1 idx already gives 67,111,008 bytes, exceeding 67,108,864 by 2,144. The minimum idx is only a conservative bound; a real nonempty max-sized pack costs more. Therefore B11's pack-size-at-C success cannot be promised under this profile. C+1 stat refusal remains a distinct observable admission case.
3. Under the proposed one-use large-offset-slot rule, idx size is `1072+28N+8L`, `0<=L<=N`. With physical entries bounded by 20,000, size is at most 721,072 bytes, before shared listing/query entry use reduces N. The peer's proposed Git-reader compatibility restriction L<=N-1 would tighten a nonempty index by another eight bytes. The 16 MiB pack-idx ceiling is therefore masked by structural/count admission; it is still a required early file-size guard. Do not generalize this mask to the separate working index.
4. Every admitted direct/program inflation byte is copied into its reserved owner, and every reconstructed result byte is copied during replay. If those operations are charged as specified, their cumulative work is at least the corresponding inflated-byte total. The 128 MiB inflated ceiling cannot be reached by a fully admitted sequence before the 32,000,000-work ceiling. This is a proposed-accounting implication, not a claim about native output overshoot/error ordering in a future codec. No counter injection or reduced caps may manufacture a public at-C pass.
5. Live occupancy is `pack + retained raw idx + decoded tables/text + cached body owners + current program + result + declared wrapper buffers + other invocation owners`. A base already counted in the cache is not charged twice, but a new duplicate result coexists until verification/dedup. The naive independent maxima 32+16+8+8+8=72 MiB exceed 64 MiB, but that tuple is not jointly reachable because the idx/count and work masks above intervene. Use the owner equation, not that impossible tuple, as the source proof. Provider readFile memory, JS overhead and native engine memory are separate qualifications, not an exact RSS ceiling.
6. All limits are below Number.MAX_SAFE_INTEGER, but attacker-supplied varints and intermediate products need not be. Validate finite nonnegative safe integers before converting, allocating or subtracting. Check `size <= cap-used`, `length <= end-start`, and multiplication bounds before constructing arrays; use bounded BigInt or checked recurrence for encoded wide values. Merely rejecting the final wrapped/truncated Number is insufficient.

Across separate command invocations, D1 repeats admission and D3 does not provide a persistent verified cache. A sequence of six queries can repeat six admissions; within one invocation, admission and query share the same counters. This is a structural cost argument, not a latency measurement or benchmark. Source and query costs must be measured separately in any later authorized timing study.

## Ownership and Graph Requirements

| Owner / state | Required source proof | Observable proof and limit |
| --- | --- | --- |
| Compressed pack | One exact-sized reservation before allocation/fill; never piece-array plus full concat. Borrowed entry views retain the pack until every codec and dependent view is done. | Reused VFS chunks produce unchanged exact output; no read after known close. Output correctness alone does not prove allocation ordering. |
| Raw idx and decoded tables | Checked count/layout before allocation; charge both while coexisting; copied numeric/OID representations before releasing borrowed idx storage. | Malformed count/size refuses before public success. Private allocation-site ordering remains source proof, not an invented public counter trace. |
| Direct body/program/result | Reserve before allocation, validate actual produced/program/result length, retain base+program+result simultaneously. Allocation throw unwinds only a reservation actually acquired. | Type/OID/output and rejection/cleanup events; no injected ledger or host-OOM experiment. |
| Cache and duplicate owners | One release authority per body; all physical representations verified before OID dedup. Commit/header/message aliases share owner lifetime; repository and catalogue must not double-release the same body. Clear/retire consumers before refund, rather than treating a count or GC sample as proof of dead views. | Query bytes and held ordinary consumers remain stable through completion. No eviction-success claim under D3. |
| Location graph | Key UNSEEN/VISITING/VERIFIED and intrinsic depth by pack identity+offset. A direct root has depth0; delta depth is base depth+1 even on cache hit. A global OID hit cannot bypass verification or reset depth. | Local forward/DAG cases and depth32/33; duplicate OIDs with different representation depths. |
| Cross-pack REF | Confirm same-pack indexed base existence before any global cache lookup. Reject a base found only loose/elsewhere; reject cross-pack cycles as missing local-base/profile cases, not as a newly supported cross-pack resolver. | Conditional missing-base fixtures, no fallback/fetch. This preserves the self-contained on-disk profile [G1]. |
| Reader / codec | Cleanup registration before acquisition, including late-created resources. Close admission, await admitted work and release idempotently; pending and late rejections remain observed. A stream-close event alone is not the native-write barrier [N2/N3]. | Controlled delayed source/acquisition/write completion and exact settlement order. No opaque-host preemption guarantee. |

Charge-before-work MUST be paired with chunked work/checkpoints: many yields followed by one giant copy/replay operation do not prove interleaving. The intended maximum 4,096 explicit work units between checkpoints must cover CRC/hash/copy/delta loops and the post-yield cancellation check. Native codec work is separately cooperative/opaque; no synchronous engine timeout or hard preemption is inferred.

## Node22 Codec and Failure Boundary

The official API describes bytesWritten as engine input, and maxOutputLength as a convenience-method limit [N1]. The inspected Node source updates bytesWritten from consumed input deltas, supports backpressure, and distinguishes destruction from callback completion [N2/N3]. A future packed helper must independently bind its successful exact-member path: default complete finish, all admitted writes settled, readable completion, exact output size, and consumed bytes equal the bounded frame remainder. Do not substitute bytes submitted, early output length, generic close, synchronous fixture inflation, or a convenience-method option for that proof. Trailing bytes/members split across feed boundaries, truncation and dictionaries remain actual-codec UNRUN cases.

The design's avoidance of private _handle/_writeState and newer-runtime-only API assumptions remains appropriate. No claim is made here that an undocumented option or source rendering establishes a portable Node22 public contract. No zlib code was executed by this reviewer.

Outcome selection preserves actual reason identity and presence separately: caller abort dominates an escaping host/sink failure; an existing operation failure is not overwritten by cleanup; local status128/usage129/diff1 remain classified separately. Falsy throws cannot be confused with no failure. Local stdout close must not cancel caller/root/sibling work or suppress required stderr. Returning/rejecting must await registered cooperative ownership, not merely settle a local promise. Exact implementation ordering remains under M1A's reviewer and the later M1B implementation review.

## Test and Validation Matrix

CASE-MATRIX.json contains exactly RC01–RC32, all future-target UNRUN, with finite named variants, B01–B12 links, source versus observable roles, root-choice conditions and explicit missing fixture/implementation bindings. There are no new public semantics, diagnostic goldens, private counter hooks or cap overrides. B01–B12 remain immutable families; format details are delegated, not duplicated. Six workflow mappings and all author DATA results remain unexecuted product/native obligations.

Before any future target assertion, capture stdout/stderr bytes, status, actual local rejection identity where applicable, effects, owned acquisition/close/write events and source/tool/input identities. An ordinary assertion failure is sticky and independent work may continue only after integrity and known-owned cleanup; unsafe admission/provenance, unknown cleanup, or integrity failure stops admission. Every nonzero worker/parent status fails the aggregate even when receipts say PASS. No retry inherits authority.

Only a separately committed, finite document-check preseal may execute the external write-spec checker on this review. Its source/import/tool/capture/cleanup scope contains no product graph. Static arithmetic is reasoned here rather than materializing huge resource fixtures. A document checker result is not design acceptance, product proof or a native comparison.

## Conformance Criteria and Readiness

This packet is complete as a bounded independent design review when its author inputs and own files are sealed, R01/R02 and D1/D2/D3 are explicit, and every future resource/ownership case remains correctly UNRUN. It MUST NOT issue implementation GO or claim M1A/M1B acceptance. The author must propose corrections in its own successor packet; ROOT must select the pending profile before implementation. Different target proof, source/build/installed/moved qualification and any native oracle require fresh authorization.

The original metadata-v1 failure/empty binding and corrected-v2 receipt are preserved. The fixture's 13 format sets, 106 entries and 18 same-author data rejects are not independent runtime/native scores. Existing histories, all 24 literal limits, default registration, private boundaries and paused YQ are unchanged.
