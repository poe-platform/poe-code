# Selected Composition Independent Review Specification — v2

Status: Prepared before execution; data/framework review only

Implemented Through: Not applicable

Purpose: Freeze bounded independent checks of the approved selected-source correction and the already presealed source/archive/package projections without product execution.

Date: August 28, 2026.

## Normative Language

MUST and MUST NOT constrain this review, not a competing product specification.
The current root assignment approves selected origins, not the entire 35da tree.
Prior review `b93241dfb9983d2b660233bdddce4569ec803f89` remains exact and unrescored.
Runtime-v2 is outside this review and MUST NOT be inspected or invoked.

## Problem Statement

The v1 source guard refused a valid selected composition by inspecting the whole
candidate source scope. Consumers-v2 must accept only the independently bound
composition without allowing caller receipts to authorize origins or additions.
The archive's 273 entries and consumer projection's 271 entries are distinct,
already declared inputs; their difference must neither be hidden nor invented
as a blocker to the intended 271-entry source-materialization call.

## Goals and Non-Goals

Authenticate correction `90c4c50070334a34c1b75d78f7da25d302f6bb61`, preseal
`61cec1d71bf1121234de8ee727da990ff29c54e8`, and data packet
`71a16afd5b430175180fc4741531b75c31b25882`. The v2 recipe raw hash is
`69dfaf2aa833590312d80515a62d1dcc544952e55f9844aea73a3a8c2d90330b`.
Expected source-map hash is
`e01d63d8e782cba59597da7c970cbd364a35582e4956ab04759064c756df1284`.

Only new files here and the requested `/tmp/yq-composition-independent-ready.txt`
may be written, plus owned isolated scratch. No product import, build, compiler,
package execution/repack, private access, XAN use, dependencies, author fix or
new YAML case is permitted. Reading source/artifact bytes for hashes is DATA,
not loaded-code review or semantic execution. Existing materializations stay read-only.

## Independent Checks

1. Authenticate v1/v2 recipes and the packet from exact Git commits, including
   modes, full membership, source authority and expected raw receipt hashes.
   Preserve the old refusal and supplemental wildcard audit failure as history.
2. Independently compare the implementation diff. Only authorizeSources behavior
   and explicitly enumerated immutable-data/import/provenance plumbing may differ;
   other guards, TYPE behavior, original 36 operation bodies and verifier stay exact.
3. Reconstruct 264 baseline entries from 5137, substituting only interpreter from
   accepted 74361026, then the exact seven manifest-bound additions from 35da.
   Authenticate ef603 manifest origins/blobs/hashes/modes. Receipt self-authority,
   HEAD/fabricated/wrong origins, wrong descriptors and missing/extra paths refuse.
4. Authenticate raw archive/package hashes before bounded parsing; compare all
   273 archive and 870 package descriptors to independent maps. Preserve baseline
   package-lock.json and scripts/typecheck.mjs as the two archive support entries.
   Full package is 846 authenticated baseline entries plus 24 authorized outputs,
   not a future fixed count. README stays exact. No independent compile is claimed.
5. Verify existing archive273, source271 original/moved and package870 original/moved
   as complete regular physical trees before and after checks, including added
   entries/modes. Compare historical move identities and absent staging paths.
   Snapshot equality is not a transaction or independent replay of a past rename.
6. Run the actual v1 refusal and v2 source/full-receipt data admissions. Compare
   the two differently serialized source receipts by both raw hash and JSON meaning.
   assertSourceMaterialization MUST accept the presealed 271 trees and still refuse
   direct submission of 273. The latter is an expected boundary, not our input.
7. Replay the 36 frozen guard operations with unchanged fixtures/expectations.
   Independently authenticate the whole driver and operation block before replay;
   a changed driver MUST be rejected before execution. Only imports and scratch/
   output plumbing change. The unrelated post-loop tool-tree audit is outside
   this bounded replay, explicitly not reported as executed or passing.

## Test and Validation Matrix

The Node driver seals 25 observations: old refusal; v2/packet source and full
data receipts; twelve receipt mutations; original/moved 271 acceptance; 273
refusal; public gap; changed replay driver; original/moved full package guards;
and changed source-authority recipe refusal. The separate unchanged-operation
replay has 36 cases, never YQ semantics. Static source/packet/diff audits are
reported separately, not added to a semantic denominator.

The Python supervisor bounds each owned Node invocation to 90 seconds, allows
two seconds TERM grace plus one second KILL reap, caps captured outputs at 2 MiB
each, and admits no next job without known-owned reap and input integrity.
Only recorded owned PID/groups may be signaled. Git reads have five-second bounds.
Raw outcomes MUST be written before comparisons. Timeout/signal/nonzero remain
visible failure; matched historical refusals are interpreted only in the worker.
No arbitrary escaped-descendant or hard-preemption guarantee is made.

## Conformance Criteria

Commit this protocol and exact check programs before running them. Every result
must bind that preseal and immutable input hashes. Genuine mismatches stop and
remain raw evidence; no foreign fixes or expectation changes to force green.
Successful results mean DATA/SYNTHETIC correction acceptance only. Author-bound
build provenance stays untrusted for product GO, public integration stays pending,
and runtime-v2/compound recipe/actual YAML review require separate root routing.
