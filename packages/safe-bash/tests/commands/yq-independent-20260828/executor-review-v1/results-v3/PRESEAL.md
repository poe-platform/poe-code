# Runtime-v2 Independent Review Specification

Status: Prepared before synthetic execution

Implemented Through: Not applicable

Purpose: Bind a narrow independent review of the sealed F01/F02/fence correction without product execution or rescoring history.

Date: August 28, 2026.

## Normative Language

MUST and MUST NOT constrain this independent review. MAY denotes an allowed
choice within the existing user policy, not a new product capability.

## Problem Statement

The original unknown-obligation and reason-identity findings require independent
verification against committed corrective handlers, not inherited author results.

## Goals and Non-Goals

Verify only the focused correction and nearby safety boundaries. Actual product,
public, type and full semantic acceptance remain outside this review.

## Authority and Boundary

This protocol governs this reviewer only, not product policy. The original
prepared protocol and ER08 clarification, results-v1 and results-v2 MUST remain
immutable. Composition review `7ed356ade4509e492e15615587408eb4b41f92e0` is accepted
only in its DATA/SYNTHETIC scope; its original postprocessor exit 1 remains FAIL.
No author control count is an independent pass.

Runtime source is `7add5d2c0a3acb27483ba0bb5dd52385812d8ed7`, evidence is
`70fa3df66f9c8dc3f972cfa8c0c5862d77d7514e`. Expected SHA256 values are:

- SOURCE-PRESEAL: `c971d27207b661ae3ee23d61d6e1ee7cfefc2b6a8a890f4e0fde228c81945c64`.
- RECIPE-SEAL: `fc273904cf20f4a717bb7350bb46046bbee16617aee371bcfd03e38d98920f15`.
- Exact diff: `ae8de91fef938c24df0293a78548492bac44435509a610bf7f7decaede5c59fc`.
- Materialized recipe tree: `6a5ca19fef1237091719a4fb7571271f1c37ff02dde4a4c65253d34bd69b2878`.

The reviewer MUST authenticate committed source membership, bytes, modes and
frozen bindings before importing the actual recipe API. Regular isolated TMP
copies use an explicit immutable Git-object reader, not live product/module
fallback. Only framework helpers, the unchanged original benign synthetic child,
and this presealed driver may execute. Product imports, builds, compiler runs,
private/XAN access, dependencies and native YAML are forbidden. No source fixes
or parallel executor implementation are permitted.

## Processing and Failure Model

The actual `describeRecipe`, `materializeRecipe`, `verifyRecipe`, host,
assert-capture, context, fixtures and import-fence handlers are the subjects.
Seven unchanged recipe files and the four exact changed files MUST match their
seals. Full recipe/file membership checks include additions and modes. Evidence
is outside the recipe/candidate; mutations touch only owned TMP fixtures.

Each control MUST save input and raw return/error before its predicate. Actual
host stdout/stderr/status/signal/effects/events/reasons and boundary records
precede assertions. A synthetic parent can expect a negative host cohort, but
the actual cohort remains FAIL. Any nonzero child, timeout or signal remains
aggregate FAIL even with PASS receipts. Independent continuation requires both
integrity and known-owned reap. Unknown integrity/reap stops admission. A timeout
may conservatively stop, or continue only after both boundaries are proved.

The outer worker has a 120-second deadline, 2-second TERM grace and 2-second KILL
reap bound, with 8 MiB captured-output cap. Actual host cohorts use 1000 ms,
100 ms TERM grace, 300 ms reap and 64 KiB capture, at most two jobs. The timeout
control uses 150 ms. Only owned PIDs/groups may be signalled. An outer timeout
stops the review; opaque/escaped descendants are not claimed contained. Source
and history integrity are rechecked after execution. No pending case is green.

## Test and Validation Matrix

Exactly 20 independent observations are planned, not 20 semantic YQ passes:

1. R01: original F01 CMD-01 input and expectation, actual host FAIL, INCOMPLETE
   assertion obligation and raw capture retained before asserting.
2. R02: original F02 same object twice versus distinct equal-looking object;
   original primitive distinctions preserved, original predicate unchanged.
3. R03: stable primitive values, negative zero, symbols and explicitly separate
   observation scopes; identity tokens are not cross-process identity.
4. R04: shared command-rejection encoder and actual fixture cleanup recorder
   preserve same/different object identities; no product command is executed.
5. R05: unchanged CMD-01 positive canned capture passes only BOUND_PROJECTION_ONLY,
   with semanticFullRecordPass=false.
6. R06: original PAR-12 partial/missing obligations stay INCOMPLETE and fail.
7. R07: an unknown expected field stays INCOMPLETE and fails.
8. R08: original PASS receipt plus child exit 7 remains aggregate FAIL.
9. R09: original FAIL-then-PASS continues only with integrity and reap, still FAIL.
10. R10: original capture-before-assert failure retains raw bytes and boundary.
11. R11: integrity-mutating synthetic child stops the next admission.
12. R12: withheld known-reap proof stops next admission despite actual child reap.
13. R13: timeout remains FAIL; any continuation requires both boundaries.
14. R14: actual fence admits exactly the newly added node:timers/promises plus
    the original builtin set, grounded in selected compiled-closure/CARRY data.
15. R15: other builtin, network/package, outside-source and symlink escapes
    still refuse through actual fence hooks; no imported fake package executes.
16. R16: added recipe entry refuses; restoration reauthenticates.
17. R17: changed recipe file mode refuses; restoration reauthenticates.
18. R18: exact 194 original IDs/eight overlays, original role counts and frozen
    job projections/gaps remain unchanged; no semantic denominator inflation.
19. R19: unbound/source-only ID and unknown data projection refuse, not green.
20. R20: missing/duplicate/noncanonical receipts refuse through actual parser.

The original receipt-producing child is authenticated unchanged from b93241df.
Original F01/F02 raw inputs, expectations and verdicts stay sealed. New results
describe the new runtime only. Inventory eligibility is not proof of execution
or current assertion completeness. No functional adapter or private DI is added.

## Integration Checkpoint

After this bounded runtime review, inspect `/tmp/yq-integration-v2-ready.txt`
once. If absent, report pending and stop without waiting. If present, authenticate
its exact final commits/seals, read committed helpers only, and add a separate
preseal before any bounded canned-metadata checks. Preserve its preparation
failures. Require source271/archive273/package870 distinctions, exact roots and
receipts, AUTHOR_ARTIFACT_BINDING_ONLY classification and no product/public GO.
Unknown or unsealed integration is pending, never an inferred PASS.

## Conformance Criteria

Readiness requires recorded actual outcomes and integrity/reap evidence, not
author success. Findings freeze raw reproductions before reporting. This review
grants no actual candidate execution approval; root must separately route a
complete compound preseal and the single actual review.
