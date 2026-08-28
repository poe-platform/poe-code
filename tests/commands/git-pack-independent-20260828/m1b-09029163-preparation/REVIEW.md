# Independent M1B09029163 source review and future preparation

Status: Bounded source review complete with a source blocker; future execution UNRUN
Implemented Through: Not applicable — source inspected, not executed or accepted
Date: Friday, August 28, 2026
Purpose: Give ROOT an actionable source/provenance checkpoint and finite execution proposal, not a launch authorization or replacement product specification.

## Scope and result

Candidate `090291636fba5b4003e5ad9771e83ad9da9e0c03`, evidence
`c74cc2a62875afc85f265431e6e6207c9e44f90c`, derived tree
`7fba78406cbf577927f5e0ce08bde4d1be08a7b3`. Only the eight changed/new Git
module files relative to M1A were reviewed substantively: README, codec, crc,
delta, index, io, pack and repository. Unchanged limits/options and selected
OutputOperation were inspected as dependencies, not a redo of Dirac's M1A suite.

**S01 is an exceptional allocation-unwind source contradiction.** S02 is an
unexecuted failure-provenance concern, not a demonstrated runtime defect. H09
resource-observer evidence is not qualified for this M1B source. This packet is
neither product acceptance nor a fully launchable executor preseal. No source fix
is made, and no old result is rescored.

## Source and package authentication

`SOURCE-AUTH.json` binds every input to exact committed metadata. All282 selected
paths have explicit origins, regular Git modes, blob identities, byte lengths and
SHA256 identities:268 accepted coherent78/noarrays inputs plus14 candidate Git
module inputs. The base selected manifest is byte-structure-equivalent to its
authenticated predecessor, and the module suffix equals its declared14-entry
manifest. Five origin commits are used; neither HEAD nor a null fallback grants
source authority.

The five M1B reconstructed tree bodies are **sparse**, not the complete source
inventory. Initial witness-only traversal left220 selected paths unresolved.
This review authenticated38 additional stored tree bodies by their explicit OIDs,
only along selected paths, then verified all282 paths. The four overlay tree
bodies independently recompute the declared derived root. Unselected historical
branches stay opaque DATA; a tree reference is not permission to build/import
its entire contents. This does not alter or rescore the unrelated rebind/O6 work.

The encoded package artifact decodes to806614 gzip bytes, SHA256
`91f5b01f7dfe284fec3d5392b715c1a321a38b00f0fa69f6afbfeb54e8fa723b`.
Bounded archive-as-DATA inspection found910 regular files, valid tar header
checksums and zero termination. Every path/mode/size/hash matches the frozen
raw RESULT package manifest:227 JavaScript,227 declarations,454 maps and2 other
files. README is not omitted:36273 bytes,0644, SHA256
`87e92b73c7339b104212a9fb11006d339694f65575a7b79debfaa902ef9cf9d1`,
exactly the selected baseline README. SHA512 integrity is recorded, not called a
cryptographic release signature. No archive was extracted, imported or executed.

Raw layer identities are distinct: author `c3aa9851…` names the encoded base64
file, not the gzip or decompressed JSON. All111 embedded raw files were hashed;
the two intentionally unembedded descriptors are separately accounted for by
selected Git blobs and the frozen tar. These are authentication facts, not
independent semantic passes or proof of the author's execution truthfulness.

## Findings and minimal unexecuted witnesses

### S01 — allocation owner acquired before its cleanup scope

Exact candidate `src/commands/git/pack.ts:117` allocates `slots`; line118 allocates
`buckets`; the protecting `try` starts at120 and releases both at150. A throw from
the second allocation/reservation skips that finally. `Session.allocate` in
`io.ts:54` unwinds its own failed reservation, not the previously acquired slots.
No outer path releases that slots owner. This contradicts ratified
`SPEC.md:82` (“Allocation failure unwinds actual owners once”) and RC06.

Minimal **UNEXECUTED source-path witness**: a structurally valid N2/L1 index
(P11-style) reaches a successful one-byte slots allocation; the subsequent
1024-byte bucket allocation fails. Follow the exceptional control flow: no
`release(slots)` is reached. This is not a proposal to inject a private counter,
lower a cap, force OOM, or assert this boundary is publicly reachable past fixed
work gates. It proves the missing cleanup edge, not a native leak, persistent RSS
growth, H09's meaning, or an observed failure. Minimal author correction to
consider: establish cleanup for the first owner before acquiring the second,
with conditional ownership-aware cleanup. Any revised product source needs its
own authorization and new candidate binding; none is edited here.

### S02 — packed writer failure attribution needs an explicit observation

`codec.ts:52` destroys the stream without forwarding the writer's caught reason,
then rethrows into `written`. The read loop at57 can reject before the successful
path reaches `await written` at65. Finally at77 awaits but discards that rejection.
The catch at70 prioritizes actual caller/operation cancellation and recognizes
the observed codec error by identity; it does not inspect a writer-primary reason.

**UNEXECUTED risk**, not a demonstrated contradiction: a genuine writer-side
work refusal at `io.ts:37` may be followed by a read-side closure failure. The
required future observation records both reason-presence flags and identities,
write/iterator settlements, operation signal provenance and terminal command
result before classifying it. It must distinguish budget refusal, actual caller
abort, codec error and secondary retirement error. Do not create a synthetic
budget knob or silently whitelist an AbortError. No claim about which event
wins on the pinned runtime is made from this source path alone.

### H09 — qualified historical criterion exists, applicability is incomplete

Criterion `1f03c93a0a857d7360bf8a418eff45bbcfa20942`,
`observer-qualification-v8/CRITERION.md`, separates operation settlement,
resource closed/destroyed states, cleanup completion, callback delivery and
later close/error notifications. It preserves exact cause identity, admits only
source-linked owned-return observations, and disclaims native caller identity
and RSS. Its target is M1A9885390f and an isolated writer, **not** the whole new
packed codec. It therefore cannot qualify this candidate by inheritance.

Needed before M1B resource credit: an exact new codec/writer/iterator and selected
OutputOperation correspondence, a reviewed bounded observer projection and raw
reason/operation/cleanup/notification schema. Until then relevant rows remain
observer-blocked. The old289 inflate /288 close notification tally is not a
proven leak, not “one live”, and not corrected by clamping or quieting errors.

## Bounded source conclusions, not runtime scores

| Obligation | Inspected source and conclusion | Remaining proof |
| --- | --- | --- |
| D1 eager | repository:80-81 admits catalogue before query; pack:97 traverses all pairs; pack:211 reconstructs every row | All six workflows, unselected corruption, loose shadow and pre-output recheck cases UNRUN |
| Framing and idx2 | pack:105 validates signatures, SHA domains/count, `1072+28N+8L`, N0/L0 and nonempty L<=N-1; slot/order/fanout/offset checks precede row use | Malformed, overflow, P11 and exact-span fixtures UNRUN |
| CRC and SHA | pack:182 covers whole physical indexed record; canonical object hash at235 or delta:49; outer pack/index digests distinct | Real changed header/base-prefix records and mismatched final OID UNRUN |
| OFS/REF/graph | pack:196 uses OFS recurrence;205 same-pack OID lookup;211 visiting states;224 intrinsic depth before global retain | Forward REF, cycles/shared DAG, depth32/33 and duplicate-location witnesses UNRUN |
| Delta | delta:6 minimum4; variable checked arithmetic; decoded base/result sizes; sparse copy parameter positions, zero copy size65536, opcode0 and overruns refused | Empty direct/qualified zero-result and exact replay fixtures UNRUN |
| Codec span | codec:65 waits writer on success,66 checks decoded size,67 compares consumed input with exact record span | Real Node zlib completion/truncation/trailing-member and H09-linked closure proof still required |
| Accounting | io:30 cumulative counters;47 live reservations;54 preallocation; delta:44 output charge; codec:60 produced-program/direct charge | RC06 S01; source-qualified masks, simultaneous-owner proof; no hard RSS or lowered-cap test |
| Pinning/dedup | pack:35 deduplicates only verified bodies;224 keeps location depth; index:32 closes admitted operations before34 releases catalogue | Actual view lifetime, duplicate representations and all resource observer cases UNRUN |
| D2 sidecars | pack:21/69-85 exact finite names, complete pair, regular file/size;89 metadata census recheck | No body authority, same-stat byte-change detection, lease or snapshot claim |
| Cooperative ownership | io:224 awaits each borrowed fragment consumer before next;283 rehashes observed pack/idx before output; selected output:90 registers disposal before acquisition | Actual cancellation, late settlement, readFile fallback and thrown identity cases UNRUN |

All24 literal numeric limits exactly match the frozen format contract and are
unchanged from M1A. The `W >= 4P-52` necessary-condition example remains a source
cost argument, not an execution forecast or proof that a pack under a per-value
cap fits the invocation. Inflated/read/resident/index maxima masked by work or
entry gates remain qualified source obligations, not successes at lowered caps.

## Evidence denominators and preservation

Author raw v2 contains140 M1A records plus93 pack/layout records per layout,
three layouts,699 author records total. Pack suites record104 invocations each;
case records and invocations are not interchangeable. The author's three positive
type groups and three four-negative groups are separate. Its nine controls are
three semantic mutants, three restorations and three binding refusals, not nine
mutants. These are authenticated **author data**, not independent passes.

Original663/12 failure data, P12F, all old seals, the50 reported retired author
children and prior preparation deadline failure remain unchanged. No separate
12-failure attribution/mapping addendum was present in the bounded author-path
inspection; REVISION-v2's prose is not substituted for that missing addendum.
All38 format rows,32 resource rows/108 variants and B01-B12 remain preserved by
exact references. Proposed named variants are a new finite partition, not a new
golden policy or a claim the old rows already ran.

The source inspection itself had recorded lookup/summary mistakes (sparse-tree
lookup, raw hash-layer assumption, two data-shape TypeErrors and an unmatched
shell glob). `SOURCE-AUTH.json` discloses them. They are not erased, converted
into product failures, or labeled successful executable controls. Final specific
metadata identities are reported separately from those intermediate diagnostics.

## Handoff

`CASE-PLAN.json` and `FUTURE-RECIPE.md` are finite **proposals**, with explicit
missing executable/fixture/observer seals. Five `.mts.data` fixtures and three
literal compiled mutation specifications are concrete deferred inputs only.
Different review and fresh ROOT scope/budget/GO are required before any target
execution. Public Git exports are absent: direct internal entry proofs do not
prove package-export admission. The write-spec skill guided this coordination
report; no new normative product spec or spec-checker run is claimed.

Product, compiler, authored helper/control, native oracle and network executions:
**zero**. No owned background process is left; synchronous metadata reads ended.
No scratch candidate/materialization or logical capacity reservation was created.
YQ and the unrelated priority/rebind packets are untouched.
