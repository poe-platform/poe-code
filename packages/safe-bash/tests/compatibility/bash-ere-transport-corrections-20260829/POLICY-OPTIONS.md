# S04 policy options — SOURCE only, ROOT decision pending

2026-08-29. Subject: transport source **02782056c436c9f2a8319f73a9eb8e2b4b5aebd5**, evidence6c884cc6. Seven immutable blobs were reauthenticated; see POLICY-SOURCE.json. No production edit, validator call, proxy execution, compiler or Worker run. All32families/60Worker variants remain UNRUN. Earlier12pure controls are not rerun or expanded here.

## Exact sites and provenance

There are two enumeration primitives, both in validation.ts:

| Site | Current admission before enumeration | Callers/provenance |
|---|---|---|
| record():34–47, Reflect.ownKeys at39 | Reject null/nonobject/Proxy/array; visit1+k; when supplied, reserve/spend1+6k scratch units plus token5. Then enumerate, require exact key count/order and own data descriptors. | Parent input record/fragments via inspectInput():94/102; Worker READY via owner.ts:88; reply/envelope/usage/result/span records via validateReply():156–196. Also Worker-side calls below. |
| array():50–68, Reflect.ownKeys at59 | Reject Proxy/nonarray; own length descriptor, safe integer and maximum; visit length; when supplied, reserve/spend2+22n scratch plus token5. Then enumerate all keys; require indices0..n-1 followed by length and own data descriptors. | Parent caller pattern via inspectInput():98, reply spans via validateReply():181, Worker request pattern via validateRequest():143. |

**Caller inputs:** root.ts:101 calls inspectInput on a caller-provided JS object, before owned snapshots and before any clone. Neither the object nor its fragment array/records are known to have been constructed by this transport. Even an array with length0 can carry many nonenumerable or symbol extras. Expected-descriptor inspection rejects accessors without invoking them, but cannot establish absence of arbitrary extra keys without enumeration. isProxy refusal occurs before enumeration; it is not proof that an ordinary object's key count is bounded.

**Owned Worker route:** root.ts:188 constructs the request from admitted owned data; owner.ts:117 posts it. worker-entry.ts:8 checks fixed constructor WorkerData; :15 checks incoming request; :25 posts a fixed READY literal. wire-engine.ts:9–32 validates requests, constructs reply records, and validates its reply before return. Parent READY/reply calls supply the parent TransportAccounting. These producers are intended to be authenticated trusted implementation code, unlike arbitrary caller arrays. That provenance can support a trusted-producer contract, NOT proof that a buggy/wrong/malicious sender cannot exceed it. Worker/load qualification is still UNRUN.

A received Worker message has already crossed Node's native clone boundary. Strict validation concerns the delivered graph; it cannot attest to sender descriptors that cloning normalized, omitted or processed. This review does not execute or newly qualify those clone details. Parent validation cannot retroactively cap native deserialization allocation. Worker V8 resourceLimits are neither a parent-heap cap nor RSS/whole-process containment.

## What the counters do—and do not—cover

Parent T=A=min(4000000,8B+128F), H=W=min(50000000,32B) are **separate** from the engine's seven counters. accounting.ts:21 defines metadata charges; :116–145 admits visits/storage. root.ts:103 reserves2(47+4n+p+s); :180 reserves479 for reply/delivery/result. Nominal descriptor/key-list/index scratch, owned copies, metadata and charged traversal remain counted; spent storage/work is not refunded on retirement. Invalid/unproved sent replies retain conservative engine/reservation handling at root.ts:202–206.

The nominal1+6k/2+22n formulas are not a measurement of native scratch or actual enumerated key-name storage. Fixed schema-name retention versus borrowed static names still needs an explicit source census under the original logical string rule; this document does not silently classify either away. No claim is made that native enumeration physically copies every key string.

The flaw is precise: enumeration at39/59 happens before actual total own-key count is available. Current scratch/H charges use the expected schema or admitted array length, not an arbitrarily larger actual list, extra names/symbol references, or native enumeration work. A length/descriptor check alone does not bound these. Replacing Reflect.ownKeys with Object.getOwnPropertyNames/descriptors merely moves the list allocation; for-in misses symbols/nonenumerables and adds inherited-enumeration concerns. Budget checks cannot preempt an already-running synchronous native enumeration.

There is a second accounting distinction, not a new execution finding: Worker-side record calls at worker-entry.ts:8/15 use no-op visit and no TransportAccounting; validateRequest():133 uses its own50000000 visit ceiling before EreLedger is created at wire-engine.ts:11; wire-engine.ts:32 validates its generated reply with no-op visit. These transport checks are **not** parent H/T and are not reported as engine matching usage. Neither a schema proof nor that local ceiling is measured root-cumulative work. Any accepted boundary must document these roles explicitly; do not merge them into the seven counters by assertion.

## Three choices

### 1. Explicit bounded-schema logical boundary — RECOMMENDED minimum

ROOT may ratify: T/H cover the declared admitted transport schema, owned metadata/copies and explicit traversals; native pre-admission own-key discovery, including a malformed shape's excess list/name retention and native work, is a **named exception**, alongside separately disclosed native clone allocation. Keep the existing nominal scratch charges; do not exempt all temporary storage. Extra/accessor/hole/symbol refusal remains exact after discovery; it is not a guarantee that a pathological trusted-host object can always be rejected before native allocation failure. No bounded enumeration-time, parent-heap, RSS or hostile-host containment claim.

Code/protocol: no wire/API/A/W/47/479 change is required merely to ratify this exception. Different review must still check the remaining metadata census and rejection/ownership paths. Worker validators remain explicitly trusted transport bookkeeping outside engine usage/parent ledgers unless ROOT separately requires new charging—not silently covered. Host callers and the static Worker producer must obey their finite-shape contract; a trust violation is not a newly contained adversary.

Docs/tests: add a versioned normative exception and exact site/provenance table to the transport profile; preserve original stricter S04 HOLD/history. Future bounded DATA cases retain strict rejection of nonenumerable/symbol extras, length0 arrays with extras, holes/accessors and long extra names; verify nominal scratch spend/no-refund and zero inherited-hook calls. Source/loader tests bind trusted producers; later malformed Worker tests retain unknown-usage accounting. Do not label these tests native allocation containment. All new tests UNRUN.

### 2. Versioned primitive framing/private input API

Replace external object/array admission and Worker frame input with a **primitive ASCII string** grammar, length-admitted before a bounded parser creates owned records. Reject object wrappers/arrays outright; fixed fields/counts, full-consumption/trailing-data checks and safe integer parsing replace own-key inspection. No JSON.parse/stringify shortcut. A trusted encoder accepting the old arbitrary objects would only relocate S04; external admission must genuinely become primitive or use a separately qualified already-owned builder.

Code/protocol: change private protocol/validation/root/entry/adapter and consumers, not Expr/public RegexExecutionOptions or engine matching. Preserve five result fields/seven counters semantically after decode. Recompute wire/storage formulas and request/reply reservations under fresh ROOT ratification; keeping47/479 unchanged by fiat would be wrong. A/W ceilings need not change. Primitive framing removes JS extra/nonenumerable/symbol/accessor/hole surfaces rather than accepting them; it does not prevent native delivery of an oversized Worker string before the handler checks length. That clone/trusted-sender boundary remains explicit.

Docs/tests: new versioned grammar/encoder/decoder and source-unit derivation; bounded length/header/count/overflow/truncation/trailing-data controls; reject every old object-shaped form before property access; exact resulting spans/counters; type and source/installed/moved loader rebind. Original60variants remain historical UNRUN until deliberately mapped to the new protocol. More work than choice1; not implementation authority.

### 3. Retain refusal/HOLD

If neither native-enumeration exception nor private-protocol change is acceptable, do not integrate/activate this ERE transport. There is no established safe subset of arbitrary record/array inputs whose absence of extras can be proven by bounded index checks alone. Existing lack of Shell integration can remain the refusal boundary without a new product error/status or guessed fallback. A future explicit activation gate would require its own source contract and pre-acquisition refusal test.

Docs/tests: retain S04 HOLD and all lifecycle/loader/60Worker obligations UNRUN; source-check that no ERE runtime route is enabled. No fake nonmatch, native fallback, or claim that type/pure passes discharge the blocker.

## Recommendation to ROOT

Choose1 only as an **explicit trust/resource-policy amendment**, not as proof the original full preallocation requirement was met. It fits the repository's existing trusted-host/provider stance and logical—not whole-heap—resource limits with the least protocol churn. Trust does not remove strict delivered-shape checks. If the actual requirement is bounded discovery on arbitrary host objects, choose2 (plus a separately explicit clone boundary) or3; ordinary own-index inspection cannot supply that guarantee. No choice is adopted by this document.
