# YQ Successor Review Preseal Specification

Status: Proposed

Implemented Through: Not applicable

Purpose: Define one finite, complete successor review proposal without admitting execution or changing frozen semantics.

Date: August 28, 2026

## Normative Language

MUST and MUST NOT state requirements for a future authorized review. This is a
**proposal-only preseal**, not a runnable recipe, candidate acceptance or RootGO.
Only static data, Git, hash, syntax and specification processing is authorized
now. Proposed executors/controls, product imports, semantic runs, typechecks and
builds MUST NOT run during this preparation. Historical artifacts stay immutable.

## Problem Statement

Different actual review `4b219eae180fcd2fd15ea864c9bc5226c54cda04` admitted 167 of
301 planned children under the old 600,000 ms admission budget: source admission
1, original runtime 149, moved runtime 17. Parent elapsed was 619,594 ms and exit
was 1; all 167 children recorded known reap and intact guards. Original children
took 281–409 ms; moved whole children took 16,840–27,231 ms. Child totals were
432,087 ms. The difference, 187,507 ms, is **unassigned arithmetic**, not isolated
setup, semantic time or a performance root cause. `HISTORICAL-OBSERVATIONS.json`
binds all raw timing references.

Old FAIL remains FAIL. Its 31 unfulfilled/INCOMPLETE job observations and CMD-22
path-domain mismatch MUST NOT be inherited as product contradictions. Four
WRK-06/07/13/17 source allocation-order counterproofs remain separately routed
repairs. The old source35da execution authorization is consumed, not retryable.

Independent build `f7503dc7dce11f9a3072b3670df498d64305d737` recorded compiler
4,812.600917 ms and proves only old35da: 434 raw outputs, 434 explicitly relocated
maps and full 870-entry serialization. It does not certify repaired sources.

## Goals and Non-Goals

The successor MUST account for all original IDs, overlays, prepared fragments,
source/type/package/control obligations, admitted tools and elapsed work. All
affected prepared parser/query/encoder/command behavior MUST replay in both
source-built and installed/moved environments without old semantic-pass credit.

This work MUST NOT change product code, frozen goldens or policy breadth; invent
public exports, private DI, limits or query instrumentation; patch sealed helpers;
drop guards; authorize native/private/XAN work; or treat source/data/type/package
jobs as semantic passes. `INTEGRATION-DELTA.json` is an implementation proposal,
not a claim that its APIs exist. No new policy decision is requested.

## System Boundary and Candidate Admission

Root supplies fresh exact receipts and an independently expected raw receipt
hash. A future sealed coordinator validates these before child admission. A
known-owned supervisor enforces deadlines. Sealed workers authenticate, compile,
capture runtime observations, inspect source evidence, check declarations or run
loaded controls. Host JavaScript is trusted code, not an OS sandbox; import fences
and PID registries do not prove opaque preemption or escaped-descendant control.

`CANDIDATE-ADMISSION.json` keeps source/evidence/handoff, selected origins,
archives/projections/full package, compiled/declaration maps, toolchain,
independent build/map relocation, runtime/consumer/loader/coordinator seals,
source-proof bindings, root receipt/hash and RootGO explicitly null/UNBOUND_DENY.
Missing, duplicate, malformed, mismatched or unauthorized values MUST deny.
Mutable HEAD or old35da blobs MUST NOT fill repaired-source slots.

Source policy remains baseline `5137a74ec855a32d8a8860eb66b62eb44d11e290`, accepted
length `74361026502d76b8c2b696f9c60e410ac9b78d95`, and explicitly authorized new
yq/private-query-adapter files only. Authority is selected-file origin
composition, not a whole candidate Git tree or fake composite commit. Historical
273-file archive and 271-file consumer projection remain physically distinct;
the archive retains its two baseline support files. Fresh manifests determine
successor counts: old counts/hashes are not assumed for repaired source. Full
packages MUST retain baseline files including README, not a yq-only projection.

Fresh RootGO MAY authorize bounded authentication/build while semantic admission
remains closed. The independently root-bound verifier MUST accept a fresh scoped
compiler receipt and explicit map-relocation/serialization proof before runtime
admission. Exact author artifact binding alone remains
AUTHOR_ARTIFACT_BINDING_ONLY. The old build proves no fresh candidate. Any proof
wait consumes the same run clock; no restart or budget renewal is implicit.

## Cohort, Roles and Obligations

`LEDGER-194.json` lists every original ID: 111 command-semantic, 34 admission/error,
23 source-static, 11 lifecycle/cooperative, four package/infrastructure, five type
and six negative-control. Eight overlays—NUM-14/15, UTF-12, ENC-07, QUE-12,
WRK-10/22/26—overlap these rows, not 202 IDs. Accepted N32/36, fixed P1 and CARRY
stay unchanged. QB64 logical source evidence MUST NOT create runtime passes.

Exactly 149 unchanged prepared jobs project 132 IDs per environment: 298 runtime
invocations, still 132 unique IDs. The 111 semantic rows retain historical 94
complete-projection eligibility and 17 partial labels. Those are selection labels,
not results. All 80 missing-binding records (62 no runtime adapter, 18 partial)
remain gaps. Preparation closes none. A full record requires all applicable
role/environment/fragment obligations, not one successful projection.

`JOBS.json` exhaustively defines **335 maximum outer slots**: authentication 1,
independent build 1, setup/admission 2, guard/data controls 18, CMD-22 worker 1
containing 31 sealed assertion fixtures, source report 1, source runtime 149,
moved runtime 149, type workers 2, actual loaded controls 10, finalization 1.
At most 12 nested compilers are admitted: build 1, direct fixtures 6, conditional
public fixtures 5. Conditional/unbound slots remain in the ceiling; their UNRUN
status earns no credit. Retries are forbidden.

`OBLIGATIONS.json` records 371 declared expected-field/element obligations and
135 precise missing bindings over the 80 records. Primitive predicates replay
unchanged. Proposed byte/diagnostic aliases refer only to existing declared
values, never invented prose semantics. Unknown fields MUST remain visible and
incomplete. Query counts, private counters, unbound lifecycle/internal observers
and unbound prose remain UNRUN. `REQUEST-ROUTING.json` maps parser, query, encoder,
CARRY, alias, signal-close, read-only, quota, types and loaded-code requests to
existing IDs without adding jobs.

## Source, Declaration and Loaded Proof

`SOURCE-PROOFS.json` has 23 designated rows, four repair obligations within them,
and overlapping ENC-07/WRK-22 annotations. Extraction is not automatic proof:
fresh selected blob/hash/line evidence and independently bound arguments, or
explicit UNRUN, are REQUIRED. The repairs cover raw document/CRLF accounting
before copy/decode, scalar admission before decode/append, member admission before
child allocation, and encoder fragments before retained construction. Source
counterproofs are not executed near-cap countertraces.

Six existing direct declaration fixtures target installed/moved declarations
matching independent source-built bytes. Token resolution MUST inspect actual
declaration/package maps, not invent exports or use workspace/source paths. Five
public-only negatives remain PUBLIC_EXPORT_GAP unless an explicitly authorized
candidate actually exposes the necessary public entry. A missing module is not
the required TS2305 rejection. Expected negative compiler outcomes MUST match the
declared diagnostic code/line inside a zero-exit worker. Wrong diagnostics,
compiler crashes and nonzero workers fail. Global typecheck and foreign
unclassified .mts inputs remain outside this scoped claim.

`LOADED-CONTROLS.json` requires one positive load and four existing mutant/witness
invocations in each environment: retained-view/UTF-22, quoted-DEL/UTF-02, the same
quoted-DEL mutation/UTF-03, and pending-shadow/ALS-04. Exact mutation preimage,
patch, postimage and full control-package manifests remain unbound. A mutant MUST
actually load and invoke the unchanged witness. Hash denial or blocked load means
UNRUN_CONTROL, not a killed mutant. NEG-05 budget/alias and NEG-06 EPIPE branches
remain explicit missing-adapter gaps. Control packages have separate exact
authority; pristine candidate guards MUST NOT be relaxed.

## Absolute Schedule and Stage Boundaries

The proposed whole-cohort ceiling is **23,625,000 ms (6 h 33 m 45 s)**. It is
conservative finite headroom, not an observed duration estimate or a guarantee
under arbitrary cohost stalls. The old 30-second ceiling is preserved for the
new import/invocation/cooperative-settlement window, with separate setup, guard,
capture and reap allocations. No measured phase split is claimed.

| Phase | Maximum slots | Cap ms | Cumulative cutoff ms |
| --- | ---: | ---: | ---: |
| Candidate authentication | 1 | 120,000 | 120,000 |
| Independent build/serialization | 1 | 300,000 | 420,000 |
| Recipe setup/runtime admission | 2 | 180,000 | 600,000 |
| Guard/data and CMD-22 controls | 19 | 570,000 | 1,170,000 |
| Source report | 1 | 300,000 | 1,470,000 |
| Source-built runtime | 149 | 6,705,000 | 8,175,000 |
| Installed/moved runtime | 149 | 13,410,000 | 21,585,000 |
| Direct and conditional public types | 2 | 1,020,000 | 22,605,000 |
| Actual loaded controls | 10 | 900,000 | 23,505,000 |
| Final guards/reap/evidence | 1 | 120,000 | 23,625,000 |

The coordinator MUST record one monotonic t0 before initial fresh root-envelope
validation. Global deadline is t0 plus the whole-cohort cap, never renewed.
Phase deadline is min(global, t0 + cumulative cutoff, actual phase start + phase
cap). Job deadline is min(global, phase, slot reservation + slot cap). Reservation
precedes all job-scoped preflight; spawning a child MUST NOT reset that deadline.
Subphase local caps also fit the same job deadline. Early finish permits early
next-phase entry but MUST NOT increase any local cap. The complete next slot,
including cleanup, MUST fit before reservation; otherwise work is UNRUN_BUDGET.
Reservation alone admits no child. Initial root validation is inside AUTH setup;
phase entry and first-slot reservation share one timestamp. Later child admission
inherits the already-consuming slot and requires its remaining subphase/cleanup
reserves. Coordinator bookkeeping and transitions consume current setup/guard/
evidence allocations, not uncounted intervals between phases.

Source slots are 5,000 setup/admission + 30,000 import/invocation/settlement +
5,000 guards/capture + 5,000 cleanup = 45,000 ms. Moved/loaded slots are
40,000 + 30,000 + 15,000 + 5,000 = 90,000 ms. The old 27,231 ms whole-child maximum
is not attributed to one subphase. Build allows 90,000 setup + 120,000 compiler +
60,000 comparison/packing + 30,000 evidence/cleanup. Type workers allow 90,000
setup + six/five times 60,000 compiler + 60,000 postguards/evidence + 30,000 cleanup.
`SCHEDULE.json` gives all other allocations and exact per-job slot caps.

TERM grace 1,000 ms plus known-group reap/KILL wait 4,000 ms are inside cleanup,
never appended allowances. Finalization fits the global deadline. Kill/reap uses
known owned PIDs/groups only. Unknown reap stops admissions; no opaque or escaped
work preemption guarantee is made. Synchronous worker stalls require a separate
owned supervisor, not merely an in-worker timeout.

**Implementation gap:** current runtime 30 seconds wraps metadata, admission,
import and semantics together. Synchronous guards can block the owner, old type
workers nest six 60-second compilers under a 30-second outer limit, and old
authorizers bind35da. Configuration alone cannot prove these proposed boundaries.
`INTEGRATION-DELTA.json` defines minimum separately versioned APIs/write scope and
ordered events; these are explicitly unimplemented, not invented helper exports.

## Tools, Loader, Guards and Failure Handling

`TOOLS-LOADER-GUARDS.json` declares future exact tool/argv/hash slots. Metadata and
compiler children MUST be registered, raw-captured, counted and deadline-bounded.
No ambient PATH, NODE_PATH/NODE_OPTIONS, workspace/source TS fallback, network,
arbitrary module search, native YAML/Bash oracle or guest subprocess is permitted.
Runtime imports use the exact compiled entry, authenticated parents/relative
files and a freshly sealed builtin allowlist. Types use owned declared roots.

Every archive/projection/package/recipe/moved/control root MUST receive exact
before/after membership, hash, mode and physical-root checks, including added
files and empty directories. Prior moved copies and parent/staging membership
remain guarded before next admission. Full baseline README is mandatory. No
repeated-copy/authority/guard optimization is enabled; any future optimization
needs a separate security argument, negative controls and new seal.

Raw stdout/stderr bytes, exit/signal/rejection facts, effects/events and phase
observations MUST publish uniquely and atomically outside candidate/recipe roots
before assertions. No overwrite or duplicate/missing/malformed receipt green is
allowed. Child identity stays stable across request/capture/receipt/reap. Actual
parent/worker nonzero, signal or timeout always makes aggregate FAIL, even with
PASS receipts. Time limits leave unfinished coverage UNRUN, not a product bug.

Provenance/integrity failure, unknown reap, source admission failure or runtime
admission failure MUST STOP further admissions. Safe ordinary assertion failures
and semantic timeouts after successful admission MAY continue only after both
integrity and known reap are positively proved; admission timeouts MUST STOP;
aggregate failure stays sticky. Unknown obligations remain incomplete, not
product failures without a bound observed contradiction. Expected assertion or
compiler negatives belong inside zero-exit classifier workers; actual nonzero
children are never exempt. Data classifiers are not real timeout/reap proof.

## Sealed Inputs and Remaining Work

Different-owner CMD-22 source `87dad0c17a425fa1347e01fefe8844679e3761e0` is bound
by its source preseal, adapter/output hashes and 31 unexecuted definitions. It
maps only frozen literal -name to resolved /v/-name under the fixed virtual
profile, preserving argv/files/status/stdout/effects and all non-CMD22 rules.
The exact API is in `BINDINGS-PENDING.json`; it was not imported or called here.
Old raw FAIL remains immutable.

Different-reviewer artifact handoff `bcfe423bd38fbc4f3f0e9c4c047d2fee7ba5a0f5`
is authenticated historical data, not execution authority. Remaining work is a
fresh repaired candidate, minimally versioned wrappers/authority helpers,
independently reviewed phase/reap/projection/type/loaded implementations, exact
tool/loader/mutant seals, fresh independent build proof and new RootGO. The author
stops at this preseal; no indefinite wait or execution admission is created.

## Test and Validation Matrix

| Requirement | Static evidence now | Future evidence, not run here |
| --- | --- | --- |
| Original IDs/roles/overlays/jobs | Ledger and exact Git/hash checks | Both environments and all obligations |
| Finite complete scheduling | Slot/phase sums and 335/12 ceilings | Independent supervisor and phase-clock proof |
| Fresh fence | Null authority slots; old GO consumed | Exact new root/source/package/build admissions |
| Four source repairs | Immutable counterproof pointers | Fresh source23 arguments and selected line/hash proof |
| CMD-22 narrow correction | Peer seal/output map/31 definitions | Authorized assertion controls and both environments |
| Types and loaded mutants | Six+five fixtures and ten loaded slots | Scoped compiler and actual loaded mutation witnesses |
| Integrity/reap/nonzero | Explicit guards and failure algebra | Independent owned-process verification |
| No execution | Static preparation history/results | No product/control execution evidence from this preseal |

## Conformance Criteria

Preparation conforms only with the complete frozen ledger, explicit gaps, exact
historical references, finite proposed scheduling, null candidate authorization
and no semantic credit. Author static checks are not independent acceptance.
Future execution requires different review, implemented sealed wrappers and
fresh RootGO. Missing phases or obligations prevent full-record acceptance; this
preseal does not assert all194 are executable or promise a green feature.
