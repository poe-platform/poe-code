# Independent private ERE L02 repair review — 2026-08-29

## Verdict

**SOURCE: ACCEPT for the approved private ownership policy.**
**PURE: ACCEPT — 16/16 author controls replayed, 10/10 independent holdouts passed.**
**PREEXEC: HOLD — the 13-cell native follow-up is a proposal, not a closed executable grant.**

No actual GO is issued. This direct review used no subagents and changed only this
new independent subtree. No actual Worker, matching, public Shell, compiler, build,
install, native Bash, network, or archive inflation occurred. The K08 review and
the concurrent K08 harness repair are untouched.

## Authenticated candidate and evidence

- Source commit: `4abbdeec8e34de88ed2cf7bd32be9c06b413c631`.
- Author evidence: `ee76c365fbbce1e04e8c01c9454476efcb06a07e`.
- Accepted transport comparison: `46611a5b`; accepted engine: `72187e5abc1179883f85a63e1ef558f2e141c542`.
- Corrected author helper: `40948d132b8dc628b39eedb3069a9298d9788ff8`.
- Private gzip: **18000 bytes**, SHA256 `dc20c2be0ea41ff11edeef105c9e93ab349a0601a14d77ecc2d6ac984dfb43b0`.
- Compiled owner.js: **9897 bytes**, SHA256 `14a1325d8f160c21ae6e97fa1e6ea3784ba7c3aa4533901298fd7966296f7464`.
- Compiled root.js: **14619 bytes**, SHA256 `41fd1b7cb5d9d78c23a65e8fb02d96181df2e5fa80bb50e36a9ce67816d997f4`.

The NUL-delimited Git inventory binds the committed author packet, including raw
receipts. Its SOURCES.json binds 12 individual source buffers. Pinned owner/root
copies are `.txt` data, not extra TypeScript compilation inputs. The final verifier
checks the other ten source buffers against the accepted Git tree and confirms
that this source commit changes only owner.ts and root.ts under production src.

PRODUCER.json authenticates all **24 raw JS/declaration emissions**. This review
loads those admitted raw bytes, not an inflated package. The base64 text is first
regular-file/size/hash admitted; decoded compressed bytes are separately checked
against the exact 18000-byte gzip hash. Gzip/tar inflation count is zero. The
25th package entry is its internal package.json; this is not a full public package,
npm installation, public export, or consumer acceptance proof.

The author receipt retains one strict build with zero diagnostics and 24 emits;
skipLibCheck is explicit. The 241-file compiler/tool closure is author evidence,
not a newly executed build or an independently repeated compiler qualification.
No negative or positive consumer type process was executed here.

## Source review

### Definitive rejection is not retirement

`src/commands/regex-execution/ere/transport/owner.ts:33` adds the explicit private
NOT_ACQUIRED/PENDING/RETIRED/UNCONFIRMED state and separate cleanup presence/value.
`src/commands/regex-execution/ere/transport/owner.ts:49` selects earlier primary,
then cleanup, then notification failure without truthiness or reason-class tests.

At `src/commands/regex-execution/ere/transport/owner.ts:165`, termination fulfillment
and rejection take different paths. A rejected termination without independently
observed exit and both stream completions becomes UNCONFIRMED; missing stream
enrollment also prevents a false RETIRED result. That definitive branch does not
await an exit promise whose listener was never installed. Ready/request rejection
is still observed before failure publication. Worker and stream/waiter references
remain retained. Late events do not upgrade a previously selected UNCONFIRMED state.

The known-retirement path at `src/commands/regex-execution/ere/transport/owner.ts:177`
joins exit, both streams and outstanding ready/request promises before clearing
the Worker and reporting RETIRED. A close rejection can coexist with RETIRED when
retirement was actually observed but an earlier setup/cleanup failure must remain
the rejection reason. Therefore **close fulfillment/rejection is not the retirement
predicate**; the private state and native observations must be interpreted separately.

### Independent enrollment and raw failure order

`src/commands/regex-execution/ere/transport/owner.ts:101` isolates exit-handler
setup; `src/commands/regex-execution/ere/transport/owner.ts:110` and
`src/commands/regex-execution/ere/transport/owner.ts:112` independently attempt
stdout and stderr. A failure in one no longer prevents the other enrollment.
No prototype fallback bypasses a fault injected into once('exit'). The owner
records the first cleanup reason with a separate presence bit, including undefined.

The persistent original fixture still throws false for *every* exit registration.
The termination implementation modeled by D03 registers another exit listener
inside a Promise executor: its second false throw produces a **returned Promise
rejection(false)**, not a synchronous terminate throw. D09 remains the distinct
synchronous throw(undefined) control. Neither pure model supplies the absent
historical native exit or stream telemetry.

### Root ownership and no refund

At `src/commands/regex-execution/ere/transport/root.ts:150`, UNCONFIRMED rejects the
ticket without clearing the active ticket, cancel listener or storage metadata.
Session cleanup at `src/commands/regex-execution/ere/transport/root.ts:72` and root
cleanup at `src/commands/regex-execution/ere/transport/root.ts:281` do not release
session/root/Worker charges on that state. The root closes admission and refuses
new work; it does not claim successful retirement or resource release.

`src/commands/regex-execution/ere/transport/root.ts:247` selects caller cancellation
at close selection before retained root primary, then present cleanup failure.
The execute catch at `src/commands/regex-execution/ere/transport/root.ts:219` retains
the corresponding caller precedence after retirement handling. Identity and
presence, not truthiness or equality-based provenance, determine these paths.

`src/commands/regex-execution/ere/transport/root.ts:194` prepays the existing Worker
metadata plus six new retained slots before owner acquisition. The unchanged
accounting implementation retains the seven engine counters, A/W policy, worker
validation prepayment and wire 47+4n+p+s / 479 accounting. No cap increase or refund
is introduced. On confirmed retirement the root may release ownership even while
rejecting the original raw failure, as D15 demonstrates.

Important wording distinction: the internal root `#closed` boolean is an admission
latch and intentionally becomes true on unknown retirement. The forbidden claim
is successful CLOSED/RETIRED lifecycle completion, not closure of new-work admission.
The future predicate saying “never sets retired/closed” must be made explicit on
this point instead of being interpreted as requiring the admission latch to stay open.

### Pending remains pending

The await at `src/commands/regex-execution/ere/transport/owner.ts:165` does not impose
a new deadline on a genuinely pending native terminate promise. Likewise, a
fulfilled termination with a still-pending stream join remains pending at line 177.
N07/N08 distinguish both from a known rejection and explicitly drive the fixed
double to eventual completion. Their finite microtask observations and the helper's
own watchdog are **not** a production universal-close deadline or hard native
retirement guarantee. A separately bounded outer owner remains mandatory.

No new production defect was established within this approved private policy.
Public integration, native ordering and the future protocol remain unaccepted.

## Independent pure execution

`pure-review.mjs` performs admission before module evaluation and installs a fixed
source-buffer loader. Only seven private JS dependencies are admitted for evaluation:
owner, root, accounting, protocol, validation, errors and limits. There are two
isolated module namespaces: one for replay and one for independent holdouts.
Both owner-only node:worker_threads imports are redirected to fixed EventEmitter
host doubles. No native worker_threads module, worker-entry, matcher, syntax engine,
public entrypoint or arbitrary file is loadable through that allowlist.

The replay uses the authenticated corrected author fixture and the exact author
D01–D16 body bytes. Only its loader bootstrap is replaced by the stricter outer
loader and its result path is redirected to this owned subtree. The original
author fake Worker is unchanged. The new fixed-host.mjs captures configuration per
instance rather than relying on later fixture changes for its pending operations.
`load-admission.json` records bindings and replay body hash; `pure-result.json`
records the actual 14 private-module loads and two importer-specific replacements.
The replay's own `loaded` list is empty because its bootstrap observer was replaced;
the independent outer witness, not that empty list, is the load authority.

| Independent identity | Fixed proof |
| --- | --- |
| N01 | Undefined setup primary versus cleanup zero; root retains ownership. |
| N02 | Null setup primary versus cleanup false. |
| N03 | Zero setup primary versus cleanup null. |
| N04 | Caller zero outranks setup false and cleanup undefined. |
| N05 | Exact caller undefined outranks setup null and cleanup false. |
| N06 | Cross-realm finite own-data ready frame; cleanup-only null remains present. |
| N07 | Pending terminate is not prematurely rejected, retired or completed. |
| N08 | Pending streams remain pending after terminate fulfills. |
| N09 | Termination rejects false after explicit exit/both-stream observations; RETIRED plus raw cleanup rejection is valid. |
| N10 | Setup false, stdout cleanup zero and stderr cleanup null retain first-failure order; both enrollments are attempted. |

N05 uses a fixed signal double because AbortController.abort(undefined) supplies a
default reason rather than the literal undefined needed by this control. N06 uses
a data-only foreign-realm object and finite own-data keys; no prototype equality
is used as a cross-realm acceptance rule. These are explicit host models, not
claims about arbitrary hostile host JavaScript.

All **16 replay + 10 novel = 26** control identities completed successfully in one
pure execution process at **2026-08-29T15:24:08.753Z**. No identity was rerun.
Unknown-model roots/owners remain referenced until helper completion rather than
being falsely classified as retired. They are not real OS resources.

Accounting qualification: the executed helper contains one redundant comparison
of absent `engine.unknown` properties. That comparison earns no proof credit.
The before/after receipts include all seven actual engine counters. The final
DATA-only verifier checks their exact own-data shapes and unchanged values, plus
positive unchanged live/reserved transport ownership and nondecreasing spent/work.
This strengthens the recorded-data check without rerunning production code or
silently changing the executed helper. N01–N05 record live=757 and reserved=53;
usage observation itself adds accounting work/spend rather than refunding anything.

## PREEXEC HOLD: exact future closure requirements

The blocking document is
`tests/compatibility/bash-ere-transport-author-20260829/runtime-preflight-v1/l02-repair-v1/FOLLOWUP-13.json:133`.
Its requiredHarnessChanges are obligations, not implemented and independently
qualified launch authority. Before any real follow-up, ROOT must receive a new
closed, sealed runner and different pre-execution acceptance covering:

1. **One complete candidate and three physical internal layouts.** Bind the exact
   private 25-entry package, all controller/bridge/loader/Worker/static bytes,
   Node executable and effective arguments/environment. Admit bounded regular
   compressed bytes and exact hash before same-buffer inflation; authenticate
   tar members and the moved origin. No build, npm install, public package or
   current-HEAD substitution is implied by this private artifact.
2. **Emergency evidence before fallible acquisition/setup.** Establish outer raw
   capture and a bounded append journal before constructor/handler faults. Record
   attempt, constructed, handler fault, termination requested, returned-promise
   versus synchronous failure, terminate settlement, actual exit and each stdio
   observation with explicit presence/value. Source inference cannot fill a
   missing native event. Journal-publication failures must retain primary and
   secondary ordering and cannot manufacture a product failure or a PASS.
3. **A real retained owner on UNCONFIRMED.** Retain the actual known Worker handle
   and root reference before fault injection. Do not clear ownership or remove,
   archive or reuse the work root because close rejected or a case process ended.
   root.retirementState is available; cleanupFailurePresent/Reason belong to the
   private owner, not public root getters. Bind a legitimate observation route for
   the native termination result instead of inventing nonexistent root fields.
4. **Versioned close predicates and strict case separation.** The first-exit-only
   single-fault fixture (SHA256
   `c41984bb63435c9e59597692e42f8fd380b78a0e8af70bc3089aa08d047f91a7`)
   is prospective. Preserve the persistent fixture separately. Single-fault
   success requires raw false at execute/root/session rejection **and** RETIRED
   with native exit and both stream completions before publication, one Worker,
   no retry. The final persistent case expects a contained nonpass/STOP, not a
   retired-success. Independent harness listeners are telemetry, not proof that
   production installed its failed listener.
5. **Inclusive clock, all roles, capture and publication.** Bind one outer deadline
   to all child admissions and terminal publication. The proposed envelope is
   **600 seconds inclusive; 22 known process starts; peak 3 processes; at most 10
   Workers, peak 1; case 10 seconds + TERM 2 + observe 1; publication reserve 180
   seconds; 64 MiB capture; 256 MiB logical work.** The graph is supervisor 1 +
   case processes 13 + administration 8. Bind all eight admin roles explicitly,
   including final publication, and do not hide Worker jobs among process counts.
   13*(10+2+1)+180=349 leaves 251 seconds for finite setup/admission. A cap proposal
   and logical samples are not filesystem quota, RSS or OS containment guarantees.
6. **No following case after unknown retirement.** Cell 13 is last. A pending
   native close is bounded only by that separately authorized outer observation
   policy. Unknown retirement, incomplete stream closure or forced termination
   cannot be declared quiescent on a timeout alone. Retain STOP and request fresh
   ROOT recovery authority rather than continuing, releasing charges or silently
   widening time/storage/census permissions.

The follow-up remains **13 cells / at most 10 actual Workers / all UNRUN**: three
constructor-no-acquisition cells, three matched-vector cells, three postMessage
fault cells, three single-fault setup cells, then one persistent-double-fault cell.
No actual Worker authorization is derived from this SOURCE/PURE acceptance.

## Deferred gates are not waived

`tests/compatibility/bash-ere-transport-author-20260829/runtime-preflight-v1/l02-repair-v1/REMAINING-COVERAGE.json:19`
retains six nonpublic obligations: messageerror route qualification, capture-byte
overflow, capture-slot overflow, exact Expr/public artifact pins, positive private
method typing, and negative old public-union typing. The overflow controls must
prove the target resource fails first rather than credit an earlier cap. Expr
and negative public typing require exact ROOT-selected public declarations and
consumer identities; this private package does not supply them.

`tests/compatibility/bash-ere-transport-author-20260829/runtime-preflight-v1/l02-repair-v1/REMAINING-COVERAGE.json:112`
retains seven CORE70 gates: root descendants, fresh independent exec, readonly
capture target, public expansion limit, public output limit, sink raw false and
short-circuited regex. Public cleanup integration must preserve the new private
unknown-retirement contract; none of these gates is discharged by fixed doubles.
Their compiler/consumer/runtime roles require their own bindings and grants,
not uncounted additions to the 13-cell/22-process proposal.

## Preserved history

Original T1 `5001adc71a9c1549822843d9cdd3bc2410fcf357` remains **75 PASS / 1 nonpass /
59 UNRUN**. Cell 76 remains Node exit 13 with unsettled top-level await and unknown
Worker telemetry. Diagnosis `874450368b4f12c63358f88c31e45babeae64d66` remains separate.
This repair explains the persistent once('exit') double fault but supplies no
retrospective native retirement evidence and does not rescore that cell.

The author's first helper SyntaxError remains **0/16 executed**; the corrected
author attempt remains **16/16**. Its separate PURE DATA publication helper still
stopped at the **500000-byte per-archive-row cap**, exact oversized row NOT_RECORDED,
no archive written and no retry. Existing raw receipts and the private package are
committed and authenticated, not lost. No complete final author census or successful
replacement evidence archive is invented. A current review allowance is not a
retroactive increase of that historical cap.

## Review budget and publication

This review starts **2026-08-29T15:16:53Z** and has an inclusive deadline of
**2026-08-29T15:36:53Z**, including publication. Its cap is 48 known OS starts,
peak 3, 64 MiB capture, 384 MiB logical work. Three helper invocations are used:
bounded data inspection, the one 26-control pure runner, and final DATA verification.
The fixed fixture modules and private module namespaces are not extra processes.
All counters are invocation-local; no ambient REPL state or zsh `path` variable
is used. Shell capture descriptors are opened before each helper starts.

Known requested roles through control 4 are **8 + 8 + 3 + 5 = 24**. Control 5 uses
shell + patch + final data helper = 3. Explicit add/check/commit and final metadata
verification reserve seven more roles, for **34/48 known starts**, peak 3 during
inspection (shell/helper/tee). This is a finite known-command count, not universal
OS census. Final verification samples only this owned subtree and records hashes,
bytes and a publication reserve; it does not assert continuous or physical quota.

The final DATA receipt checks source and load closure, all 26 recorded identities,
the actual seven-counter receipts, the unchanged 13/10 future counts, and the 6/7
deferred partition. No further production evaluations occur. Publication uses
explicit owned paths with git commit --only; hooks/signing/automatic maintenance
are disabled for that command. Foreign staging is preserved, with a separate
post-commit index check. Commit metadata is reported separately to avoid a
self-referential publication hash.
