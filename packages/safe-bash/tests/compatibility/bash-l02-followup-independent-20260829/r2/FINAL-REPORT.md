# L02 r2/r3 independent PREEXEC review — HOLD

## Bindings and results

R2 source `8e78572c234c234c01469c852414f012349b5917`; r3 source `345931a8304146b6556ada2e3cf0f3792a9158e1`, evidence `ee47a8efc0161fa9344bc7ac49b489436631a37a`, profile `1c2b19a7b8a8b2d91bae89045d6077e81b4b0f10af359da44d89d8b469fe808e`. Exact author replay **14/14**; independent novel **5/6**. Two harmless children (exit0/exit7) have retained exit/close/stream completion receipts; no Workers or product cells. The r3 six author controls are reported evidence, NOT independently replayed.

## F01 — inconsistent stream completion accepted (PURE)

`followup-preparation-r2/receipt-gate.mjs:2` validates end-flag types, but its line3 ownership conjunction omits their truth. N02 independently sets `stdoutEnded=false` or `stderrEnded=false`; both judgments return PASS despite contradictory required completion. This exact gate is imported by r3 (SHA `30423812ddc5e82a9598878f63a628aa781987616e3239cedc8680ce661401a3`). Require both end flags true without weakening descriptor or chronological checks. This is an inconsistent DATA acceptance, not an observed runtime loss.

## F02 — UNKNOWN latch follows fallible work (SOURCE only)

`followup-preparation-r3/supervisor.mjs:3` calls judge, then fallible post-case census/cap/hash/output checks, and only later sets `unconfirmedWorker=true` for STOP_UNCONFIRMED. A throw in that interval reaches captureScope and returns `retainedUnknown=false` (line5) when the retained direct-child list is empty. The admin path relies on that flag; exitCode2 is allowed. Latch known uncertainty immediately after judgment, before any fallible work. Also preserve conservative uncertainty if receipt read/judgment fails before lifetime evidence is authenticated (or validate lifetime independently first). No supervisor or Worker was executed by this reviewer; this is control-flow evidence, not a claimed actual leak.

## r3 policy delta

The schema3 startup fields explicitly qualify reserved/postchecked files, NOT prewrite enforcement, observed EOF or inferred Worker retirement. Admin checks actual bounded file size/hash. The added publication outer pair reserves131072 bytes, giving capture6078464 and logical work21594112. Shared Git-internal physical storage is excluded/trusted/unobserved; owned Git streams remain counted. These SOURCE changes match ROOT policy but do not fix F01/F02 or prove actual startup/retirement. Prospective13cells/at most10Workers/27 charged image roles/peak3 conditional exec graph/600s including180s publication remain UNRUN. Roles are not observed distinct PIDs or an OS quota.

## Remaining minimum before activation

1. Author fixes F01 and F02 in a new sealed successor, followed by focused independent checks. No author edits made here.
2. Authorized DATA-only provision of exact390-file capsule into fresh r3 CASES and owned FUTURE-ACTUAL-01. Inventory is byte-identical to r2; authenticate regular size/hash before decode, sameBuffer bounded inflate, exact safe unique full set/per-file bytes/hash/modes. Existing relative case bindings permit copying exact bytes without compiler/install/product evaluation. This review did NOT inflate or provision it.
3. Fresh corrected profile/source/tool/fixture binding, ROOT grant/window and independently qualified admission. No actual GO follows this review.

Original holds and failures remain unchanged. R2 intermediate report is preserved; this additive disposition closes the r3 delta review. See R3-DELTA.json, NOVEL-RESULT.json, AUTHOR-REPLAY-RESULT.json, RAW-REVIEW-CAPTURES.json and POSTGUARDS.json for evidence.
