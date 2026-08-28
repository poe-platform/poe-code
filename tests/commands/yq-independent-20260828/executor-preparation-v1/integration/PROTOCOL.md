# YQ Compound Binding Specification v1

Status: Proposed execution preseal; preparation synthetic only

Implemented Through: Not applicable

Purpose: Compose the two immutable executor components without changing their
contracts, expanding YQ policy or authorizing a product run during preparation.

## Normative Language

MUST/MUST NOT apply to this binding recipe. Original runtime and consumers trees
are read-only. Only new `integration/**` and the framework coordination README
are owned. This recipe MUST preserve the 194 IDs, eight overlays, semantic
111/94/17 classification and 80 gapped records; no new semantic case is added.
Root MUST supply a later independently hashed execution envelope, accepted
admission/review receipts and exact candidate paths before execution. Merely
finding an unsealed worker artifact or mutable HEAD is not authorization.

## Problem Statement

The two sealed components use different source/provenance, tree-hash and
materialization interfaces. This wrapper must bind them without silent bypass.

## Goals and Non-Goals

Prepare a functional deferred composition and preserve honest proof routing.
Do not execute a product, replace a sealed component, or add semantic breadth.

## Interfaces and Configuration

`core/COMPONENTS.json` binds runtime c49d494d/ee9d0c1f, consumers 40944913 and
the exact 35da1854 author artifacts. All helper byte hashes and both component
recipes MUST be authenticated before loading helper APIs. Candidate code is
loaded only in owned children after admission. No runtime/source fallback exists.
`README.md` documents the exact envelope and existing consumer receipt schema.

The 870-file package MUST retain all 846 baseline files, including the exact
baseline README, and exactly 24 emitted additions. Source/archive, serialization,
compilation and package byte identities are distinct proof roles. Author 26/19
test successes MUST NOT be inherited. Independent build proof is separately
receipted; no build engine or global typecheck is added here.

## Source Compatibility and State Machine

The author revision identifies seven selected new paths, not an authorized
whole-tree consumer candidate: its consumer-selected Git view has 301 paths,
whereas the accepted composite has 271. The sealed consumer `authorizeSources`
MUST retain that refusal. A root-routed exact composite Git object may satisfy
that existing API only with explicit linkage to the seven 35da1854 paths and
unchanged baseline/accepted length. This recipe creates no such Git object and
does not silently substitute one. Otherwise a minimal separately reviewed
consumer source-admission v2 is needed; do not patch the sealed v1.

The 273-file author archive and 271-file consumer source view MUST be separately
bound. Only the archive's exact `package-lock.json` and `scripts/typecheck.mjs`
are absent from the consumer view; preserve and guard the full archive too.
No subset is called unchanged full-source proof. Both views are read-only.

Execution order is authenticate -> bounded read-only source/package admission
child -> original compiled jobs -> freshly moved compiled jobs -> loaded-code
control -> scoped declaration worker. Each environment has exactly 149 jobs
over the same 132 IDs. Private/source-only obligations remain pending. Parent
source validation children are infrastructure, not product imports or passes.

## Safety, Captures and Failure Recovery

Use the sealed runtime host's known PID/process-group deadline and reap logic.
Every worker exit nonzero, signal, timeout or malformed/missing receipt MUST
fail aggregate status. Expected TYPE compiler exit 1/2 is classified inside its
worker against the declared diagnostic; it never waives a worker nonzero exit.
Raw stdout/stderr/exit and worker-produced diagnostic/capture data MUST precede
assertions. Consumer compiler raw records are its sealed UTF-8 text schema,
not a new claim of arbitrary-byte compiler transport fidelity.

After a normal failure, independent jobs MAY continue only after both integrity
and known-child reap are proved. Timeout always fails; it is not itself a
continuation veto if both proofs succeed. Missing movement receipts or uncertain
new materialization integrity MUST stop admission. Source prerequisite failure
stops product admission regardless of reaping. A global admission window bounds
the finite 301-child recipe; it does not promise opaque host-call preemption.

Candidate/source, original and moved package, component recipe and receipt
guards MUST include membership, added entries, bytes and modes. Evidence uses
fresh unique no-overwrite directories outside every guarded input/package.
Materialization is explicit and physically moved via the enrolled consumer API.
No foreign kill, escaped-descendant proof, implicit host VFS/network, or security
sandbox is claimed. Preload harness imports before the exclusive consumer hook.

## Test and Validation Matrix

`core/SYNTHETIC.json` predeclares only composition controls: schema/hash refusal,
source-view mismatch, complete README/package maps, pure tree/hash translation,
receipt status gating, exact TYPE diagnostic classification and unchanged ID
routing. Seal fixture/helper source before these data-only checks. No candidate
code is imported, built, typechecked or run during checks. Both component seals
are checked before and after. Prior runtime 15-control evidence is not the
different reviewer's acceptance of this compound recipe.

## Conformance Criteria

Completion means a sealed deferred interface, passing scoped synthetic/data
checks, truthful incompatibility/gap record and root handoff. Public admission
remains `PUBLIC_EXPORT_GAP`, not a product bug. Root's actual source/parser/query/
encoder/CARRY/alias/signal/quota probes beyond prepared projections MUST be
separately presealed by the different actual reviewer using actual exports.
All missing lifecycle/private controls remain unclaimed; no policy roundtrip
or private DI is introduced. Actual candidate execution awaits root routing.
