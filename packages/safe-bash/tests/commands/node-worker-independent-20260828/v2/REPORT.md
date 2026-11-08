# Different review: Worker proposal v2

2026-08-28. **SOURCE/DATA ONLY. No provider implementation or runtime acceptance.**

Candidate: `82aae2f5bff404423e81ddb6ddfacb6e0abd35a9`.
HANDOFF SHA256:
`6041fe928927ffc672075a5fbbdfb38b0360b8af750e6ce184d57d0884208682`.
SEAL SHA256:
`afeeb6c6aa42577b9e7e0e7ebd682cf0ace17e09c54368a1c2d1101cc097b7a4`.

## Decision

**D1–D3 are faithfully incorporated; do not reopen them.** v2 materially improves
the transport and resource design. F3/F4 are resolved at the design level; F1/F5/F6
now accurately describe remaining qualifying-provider obligations rather than
claiming missing hooks exist. All28 FS-code names and eight WRQ/L mappings match.

**Not yet a complete implementable provider specification.** One concrete F7
source/profile incompatibility needs correction (R1). Three small wire/lifecycle
details need explicit completion before a transition model is frozen (R2–R4).
K1–K4 remain genuine implementation/qualification prerequisites, not new ROOT
policy questions or evidence that the requested Node feature is complete.

Recommend a narrow document correction and a frozen provider/scaffold feasibility
recipe, not another broad redesign, new contract features, or production GO.

## What was actually checked

Preseal `bf6cead9`; first recipe `7aeab85a`; extractor correction `bfd6e7eb`;
supplemental source/arithmetic preseal `a7221859`.

- Authenticated the stored candidate commit and its exact12-file NUL-delimited
  Git inventory; all candidate blob hashes match the read bytes.
- Matched both ROOT-supplied hashes, all11 other sealed output bodies, and24
  sealed input body byte lengths/SHA256/blob hashes. These are body checks, not a
  new whole-tree authentication of every historical input commit.
- Independently matched the28 code names to `ErrnoCode = keyof typeof descriptions`
  at the pinned errors contract, with its separate Git membership binding.
- Checked all eight ordered WRQ01/L01 through WRQ08/L08 mappings and zero executed
  qualification count, seven F dispositions,16/32 header words, physical3/active1
  slots and the197056-byte layout.
- Inherited the previous review's authenticated37 public function bodies/66
  blobs/13 trees through their sealed result/archive hashes. **Not a new engine
  body or loaded-module replay.** No actual provider entry is supplied by v2.
- Supplemental pinned package/build-config bytes authenticate separately. The
  configured build target is ES2023 with no class-field override.

Three serial DATA-only Node invocations, peak one: first extractor exit1,
corrected checker exit0, supplement exit0. The first mistook the type alias for a
quoted union and extracted0 names; its failure is retained unchanged. The correction
reads the descriptions keys without evaluating TypeScript. Corrected main logical
work2,434,895 bytes; supplement133,018 bytes; combined work including the first
attempt remains below64MiB and captures below16MiB. Each invocation completed in
its bounded tool call; no active child/session remains. No Worker, engine, compiler,
product module, native oracle, private checkout, service or package installation
was executed. No source/module/resource performance score follows.

## Ratified semantics: confirmed in the packet

| Decision | v2 binding and review |
|---|---|
| D1 | Explicit L-entry-return, sync text-I/O, `.cjs`/eval/primitive print/stdin and JSON workflows with separate grants. Synthetic argv/env/cwd are data, not native process. No promise-fs, process.exit, npm/npx/package search/.js/ESM/TLA exposure. Existing useful options-record/wx forms remain required, not silently deleted. |
| D2 | Separate transport staging from complete-payload effect admission; parent non-reentrant gate enrolls before calling VFS/sink. ACK/FREE are not delivery. Parent cutoff fixes admitted set; print is authorized/published before terminal. Status0/1/2 only after actual exit AND parent cleanup, without masking actual parent failures. |
| D3 | 16MiB named ledger/fixed SAB/V8 limits remain distinct from RSS/whole-guest8MiB. Five seconds starts at ownership enrollment, includes startup/source, and is closed at normal cutoff. Normal drain does not abort preadmitted work or reset counters. Caller cancellation remains live, wakes/requests termination immediately, with no grace or fabricated cleanup deadline. |

Ordinary allowed language continuations may be abandoned. The packet consistently
leaves their counts unknown; entry settlement and Worker retirement do not become
all-jobs-settled receipts. Original NP1 and old asynchronous/Q cases remain held,
not passed or replaced. Parent control priority and existing Shell mapping are
referenced, not redefined using reason equality or Worker exit status.

## F1–F7 disposition

| Finding | Independent conclusion |
|---|---|
| F1 | Correct ownership direction: one run, interpreted module/JSON roots, private primitive facade, reauthorization on cache hits, transient copied envelopes never establish guest identity. K1 still lacks actual legitimate descriptor/JSON/scaffold-hiding implementation. Required options/wx cannot be declared complete by primitive signatures alone. |
| F2 | WORKER_OWNED, checked global frame allocation, per-slot predecessors, upload-credit/data and result ACK distinctions materially address v1. Fixed full scratch stores are charged. R2/R3 must close small remaining formal/schema holes before an executable model is bound. |
| F3 | Design-level resolved: header/partial staging is not effect admission; even empty truncation requires enrollment. Complete payload validation plus OPEN/grants/reservations and enrollment occur without await/reentrant callback; a later cutoff cannot authorize staged data. Actual implementation still unproved. |
| F4 | Design-level resolved: independent stop/wake never overwrites peer-owned payload; active slot0 only; raw parent provenance remains outside wire. Per-operation cleanup cannot depend on guest return/ACK, preventing the stated circular wait. Actual wake/late-response/cleanup races remain unrun. |
| F5 | Correctly held: no final-ACK or terminal-watermark delivery shortcut. A genuine post-copy/error-handoff witness is still missing. Without it, known rejection remains undelivered; this safe refusal cannot be counted as required ordinary catchable-FS-error support. |
| F6 | Ratified maxima retained, named capacities/copies and producer/journal gaps disclosed. Counter/layout arithmetic is coherent; enforceable precharge and exact overlap/source/launch bounds remain K3/K4, not a16MiB guest/RSS guarantee. |
| F7 | Vocabulary fixed: exactly all28 pinned codes; no toFsError coercion/shape-authentication or portable-errno invention. **R1 remains:** extraction rejects the actual source class's unspecified optional-field representation under the pinned build profile. |

## R1 — Typed optional fields: concrete source/profile mismatch

Pinned `src/contracts/errors.ts:48–50` declares uninitialized optional class fields
`readonly syscall?: string`, `path?: string`, and `dest?: string` without `declare`.
The constructor only assigns these when an option is supplied. The pinned
`tsc -p tsconfig.build.json` uses target ES2023, with no override of class-field
semantics. TypeScript's official documentation specifies standard field semantics
by default at ES2022+, including initialization of fields without initializers to
undefined. Therefore an unspecified optional field is an **own data field whose
value is undefined**, not necessarily an absent descriptor.

But `ERRORS.json#/FsErrorDTO/wire` explicitly rejects present undefined, and its
extraction route turns invalid required/optional metadata into an escaping parent
failure. Under that source/build profile, ordinary `new FsError('ENOENT')` has
three such fields; `new FsError('ENOENT', {path:'/missing', syscall:'readFile'})`
still has unspecified `dest`. The proposed path cannot promise normal guest
catchable ENOENT simply because the code name is present in the28-code table.

**Qualification:** this is a pinned-source + compiler-semantics inference. No
compiler, emitted module or FsError constructor was run; it is not a measured
runtime failure or a request to alter the existing FsError implementation.

Smallest proposed correction: on the already-authenticated typed-FsError route,
treat an absent descriptor **or an own data descriptor with value undefined** for
these three optional source fields as unspecified, encode the existing null wire
sentinel, and omit the guest optional field. Preserve the original parent error
and its descriptor facts. Keep required fields strict, reject getters/present null/
wrong types, keep undefined forbidden on the wire and on guest/options/control
schemas, and do not accept arbitrary shape-only host errors. This is a narrow
source-representation adaptation, not a new global API or blanket undefined rule.
ROOT/author must adopt the correction; this reviewer did not edit their packet.

Required later controls: true absence, typed own-undefined, real string including
empty, getter, null and wrong type; ordinary real missing-file error; all28 code
names/available metadata; caller/sink errors shaped like those codes still retain
their original routes. Do not construct a lookalike and label it actual FsError
authority or erase the original v2 rejection rule/history.

Primary references (read, not executable inputs):
`https://www.typescriptlang.org/tsconfig/#useDefineForClassFields` and
`https://www.typescriptlang.org/docs/handbook/release-notes/typescript-3-7.html#the-usedefineforclassfields-flag-and-the-declare-property-modifier`.
The pinned config/build-command hashes are in SUPPLEMENT-RESULT.json.

## R2 — Complete the zero-result edge without changing the intended policy

The14 transition rows include RESPONSE/RESULT_META -> WORKER_OWNED, whose prose
says zero text/void/error requires FINAL_ACK. They include a positive-text
WORKER_OWNED -> ACK/META_ACK edge and a RESULT_DATA-derived final ACK, but no direct
WORKER_OWNED -> ACK/FINAL_ACK edge for metadata-only completion.

The prose's intent is clear: it is **not evidence that the abstract protocol
intentionally rejects void or empty reads**. A literal14-row state model lacks
that path. Add an explicit guarded edge or a formal expansion rule before claiming
complete transition coverage: metadata validated, result total/offset0, exact
result tag, empty ACK payload, precharged/allocated frame, predecessor match and
stop check. This covers empty read, successful write/output/auth, denied,
unsupported and FS-error replies. No new state/capability is needed.

## R3 — Freeze exact control/cache scalar schemas before a model/Worker recipe

The v2 request keys and result wrapper keys are explicit. READY and doorbell
records are bounded/prose-owned, but v2 does not give their complete own-key/type
tables or explicitly inherit a version-adjusted v1 table. Likewise cacheKey's
`namespace` is called a bounded parent-issued handle without an exact scalar type
or numeric/string bound. These are details an implementer could choose, but an
independent exact-schema model must not invent them implicitly.

Smallest completion: bind READY/doorbell keys and v2 session/seq/slot/frame rules;
define namespace as one exact bounded primitive with explicit lifetime/lookup and
canonical encoding. It remains a routing label attached to actual authority, NOT
storage identity/disjointness. Do not change the public filesystem contract or
introduce cross-client identity. Preserve the JSON key recheck at read completion,
failed-install rules and same guest object on cache hits.

## R4 — Initialization failure is not an unconfirmed live Worker

The all-outcomes cleanup rule must distinguish **never acquired/proven synchronous
creation failure** from **creation in progress/actual handle not yet exited**.
Source/usage/grant rejection or pre-aborted invocation can happen before Worker
acquisition. Such a path must not await a nonexistent exit event or fabricate one.
Conversely, a late-created handle after a throwing/aborted provider acquisition
remains tracked until its real exit. This is the existing acquisition-before-
ownership/rollback rule, not a new status or permission feature.

Spell this distinction in the entry/lifecycle recipe and test constructor failure,
late acquisition and caller cancellation. ROOT's actual-exit requirement remains
unchanged whenever a Worker was acquired or might still be acquired. An owner
with proven no Worker still must close all other admitted resources.

## Resource arithmetic and safety observations

The197056-byte SAB and four65536-byte endpoint scratch stores are distinct. The
frame allocator is one global atomic word; payload ownership is acquired by CAS;
only slot0 is active. Per-slot predecessor validation, not global arrival order,
guards publication. Every request, upload credit/data, result metadata/body and
ACK frame is charged, including empty ACKs; reserved/unpublished IDs burn capacity.

For valid traffic, an operation uses `3 + 2*ceil(bodyBytes/65536)` frames. Read data
replacement UTF8 may expand to at most3 times acquired raw bytes, so a conservative
aggregate body bound is12MiB read responses +4MiB writes +1MiB outputs =17MiB.
Adding a full ceiling allowance for each of128 operations gives400 body chunks
and **1184 published frames**, below4096. This is deliberately loose arithmetic,
not actual traffic, a new allowance, or a guarantee all live copies fit16MiB.
Invalid/unpublished frames still count and may stop admission. Global counts
alone do not prove transitions, allocation-before-check or cleanup.

Actual body staging, grant checks, full-result consumption, FRAME/CREDIT/ACK
copy ownership, explicit sink publication and bounded diagnostics remain required.
No ACK is a filesystem mutation, a freed slot is not a delivered guest error,
and no exit or timer creates parent cleanup. An implementation must demonstrate
these separately with authenticated operation/effect observations.

## Next authorization boundary

See MINIMUM-EXPERIMENT-PRESEAL.md. It is a proposal, not execution authorization.
First repair R1 and complete R2/R3; bind R4 and the concrete K1–K4 provider recipe.
Then an independently reviewed finite transition/validator model can precede
separately authorized actual WRQ observations. No need to reopen settled D1–D3,
rescore old NP1, or execute the separate private-ABI8 experiment to review this
ordinary-public-bridge route.
