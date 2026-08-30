# Completion and Sealed Integration Review Specification

Status: Prepared before completion and integration execution

Implemented Through: Not applicable

Purpose: Verify saved runtime evidence without rerunning it, then narrowly review the now-routed integration seal with canned metadata only.

## Normative Language

MUST and MUST NOT apply only to this verifier. Existing user authority and all
original protocol predicates remain unchanged.

## Problem Statement

All 20 runtime controls matched and their worker exited 0. The outer invocation
then exited 1 because two equivalent unified-diff alignments were compared as
raw strings. That failed invocation MUST remain FAIL; the runtime controls MUST
NOT be rerun or rescored. The exact routed diff hash remains mandatory.

## Goals and Non-Goals

The completion check applies each authenticated unified hunk to authenticated
original bytes, checks every context/deletion and exact materialized output,
and verifies saved process/observation/boundary records and full integrity.
This checks patch meaning without inventing a canonical diff formatter. Both
diff serializations and the original failure are retained. No original policy,
author handler or runtime control is changed.

The sealed integration handoff was present at the bounded checkpoint. Review
source `4fafd93a2a414fe9ce1965f77ab45da1d417d10a`, evidence
`83035d641c415019ac62a0d0114cf2836ba77e45`, seal
`47c3874f520efee18062d4b2e687159a52039a86d35945a7f5371e85eb00fdff`, recipe
`eecdc319fc90ccc89bdae0fbb7900beb33dbd07807c4fa78738280b77e412158`, and delta
`616f64e1966f43ab37a241414026b4b82b88b5679956573bc16aa1c7c1a9ac3f`.
Authenticate exact Git membership/modes/hashes and preserved preparation failures
before importing any integration helper. No author success is inherited.

## Test and Validation Matrix

Static review covers actual binding/components/translation/run/worker helpers,
the unchanged moved worker, pinned runtime-v2 and consumers-v2 interfaces,
source271/archive273/package870 separation, exact packet receipt bindings,
AUTHOR_ARTIFACT_BINDING_ONLY, 194 IDs/eight overlays and all80 remaining gaps.
Full positive bind/loadComponents/run/worker execution remains deferred: this
stage does not fabricate a root acceptance receipt or candidate capability.

Exactly ten canned-metadata controls invoke real integration exports:

1. I01: complete synthetic envelope accepted as metadata, not root authority.
2. I02: HEAD, fabricated or wrong selected origins refuse.
3. I03: wrong packet receipt paths/hashes or missing independently supplied raw
   hash refuse; no self-authorizing receipt.
4. I04: missing runtimeRecipeRoot or added public-success fields refuse.
5. I05: claimed independent compile or build receipt refuses; only the sealed
   author-artifact classification remains permitted.
6. I06: actual translation retains the selected271 runtime source, all870 package
   descriptors and exact candidate/CARRY/recipe binding, not archive273.
7. I07: actual full-package helper retains exact README and refuses missing,
   mismatched, extra or omitted-baseline inputs for this pinned870 packet.
8. I08: actual continuation helper preserves nonzero/timeout/signal FAIL and
   requires integrity plus known reap before independent admission.
9. I09: actual integration verifier rejects added entries and mode mutation in
   an owned TMP copy; restoration reauthenticates.
10. I10: missing root arguments refuse in actual bind before component loading.

Each observation captures raw input/return/error before comparison. One owned
Node worker has a 30-second deadline plus 2-second TERM/2-second KILL reap.
It spawns no children and imports only authenticated integration helpers, which
are statically inspected not to execute work at module load. The driver emits
one bounded summary; raw stdout/stderr/status/signal are captured before verdict.
Every nonzero worker remains aggregate FAIL. No unsafe continuation is allowed.

## Conformance Criteria

Report runtime predicate matches separately from the retained failed outer run;
report integration metadata checks separately from full binding/loaded-code
coverage. Preserve all original preparation failures and classify all counts
as framework/data only. Actual candidate imports/runs/builds/types remain zero.
Public integration, independent compile, full root/review receipt bindings and
the actual-review route remain pending. This completion grants no product GO.
