# Selected Source Admission Correction Specification

Status: Proposed correction; separate framework review required

Implemented Through: `409449136ae1adc252ff6e205a6bb5785d113d0f`

Purpose: Correct the consumer harness source-origin check without changing product policy or the other frozen guards.

## Normative Language

MUST and MUST NOT identify required harness behavior. MAY identifies an allowed data-only operation. The original preseal commit retains the pre-reproduction document; this heading clarifies notation without changing any control or source policy.

## Problem Statement

The immutable v1 guard at `consumers/guards.mjs:200` enumerates the entire candidate commit's `src`, README, package and two configuration paths, then compares their content at line 208 to a separately composed baseline-plus-length-plus-new-files map. Static Git inspection finds eight changed baseline paths and thirty unselected paths in the authorized candidate's global tree. This is an implementation hypothesis pending the presealed raw v1 refusal capture, not a product failure claim.

Root authorized a selected composition: baseline `5137a74ec855a32d8a8860eb66b62eb44d11e290`, interpreter from accepted length `74361026502d76b8c2b696f9c60e410ac9b78d95`, and seven exact new files from `35da18547ca82a67be9ca22b4adc21e3b8060780`. The candidate commit binds new-file origin, not the other features in its global tree. No ancestry requirement exists.

## Goals and Non-Goals

This v2 MUST correct only source-composition authentication and the necessary immutable-data/deferred-worker plumbing. It MUST preserve all v1 files, 39 recipe entries, original controls, fixtures, compiler-status rules, package/movement/import checks and public-export refusal. It MUST NOT execute YQ, import product modules, build, typecompile, repack, modify product/root/private files, create replacement commits to satisfy v1, or introduce dependencies. Data-only Git/hash/admission calls are permitted.

## Authority and Trust Boundary

`SOURCE-AUTHORITY.json` binds the root-selected new-file write-set, exact candidate/evidence/handoff commits, source manifest and archive/package hashes. It is not authority merely because a caller repeats it in a receipt; the root MUST independently authenticate the final v2 recipe commit/seal. The v1 recipe and relevant implementation/data bytes MUST be authenticated before any v1 harness code is loaded or data referenced. Live HEAD and caller-invented origin maps MUST NOT substitute for these immutable bindings.

The source-only and full receipt schemas remain v1 schema 1. Their candidateCommit MUST equal the newly pinned 35da commit, and sourceAdditions MUST equal all seven root-authorized descriptors exactly. A new future candidate requires separate root authority and a new sealed binding, not a mutable switch.

## Composition Invariants

For each of the 264 v1 selected baseline source/configuration entries, the v2 guard MUST authenticate path, Git blob, raw bytes, size and mode from the exact baseline commit, except the interpreter path which MUST use the accepted length origin. The baseline selected path set MUST be complete and equal to the original v1 selection. README and root exports/package/configuration remain baseline bytes.

Each of the seven new entries MUST be absent from that baseline selection, appear in the authenticated author manifest, and match its exact selected candidate Git blob, bytes and mode. The receipt MUST NOT authorize replacements, omissions, unknown additions or alternate origins. The resulting sourceFiles map has 271 entries under the unchanged v1 source scope. Unselected candidate-commit entries MUST NOT enter that map or veto it; no content from them is accepted, imported or compiled. Actual materialized source membership remains exact and rejects extras.

The author source archive has 273 non-test members: the selected 271 plus baseline `package-lock.json` and `scripts/typecheck.mjs`. Those two support files are outside the original consumer source-materialization scope. This correction MUST NOT silently add them or waive that scope. Directly submitting the complete 273-member archive tree to the unchanged source-materialization guard remains a separate integration gap requiring a precise root proposal. This task does not materialize or build it.

## Defect Capture and Failure Semantics

Before changing the guard, the presealed reproduction MUST call the authenticated original v1 authorizeSources with the root-bound source-only receipt. Its raw stdout, stderr, status, signal, error, guard hash and source locations MUST be captured before checking the expected SOURCE_BINDING refusal. An unexpected outcome is a failed reproduction, not assumed confirmation. The original evidence MUST remain immutable.

v2 wrong source origins or descriptors MUST fail before any product work. A matched actual-candidate data admission is `ADMISSION`, never a YQ semantic pass. Compiler behavior is deferred and unchanged: the TYPE worker interprets a declared nested compiler rejection, while every nonzero worker child remains aggregate failure. `PUBLIC_EXPORT_GAP` remains mandatory.

## Artifact Data Checks

If archive bytes are read, their raw SHA-256 MUST equal the independently root-supplied expected digest before parsing. A bounded in-memory regular-file tar inventory MAY verify raw bytes, names and modes; no artifact is imported, extracted for execution or repacked. The full package MUST contain every accepted baseline entry, exact README bytes/mode, and only the 24 outputs from the six new TypeScript files, totaling 870 for this candidate. This candidate-specific check does not turn 870 into a future global count. Root-owned artifact-admission evidence MAY be consumed only once sealed and authenticated; no coordination wait is required.

## Test and Validation Matrix

`CONTROLS.json` predeclares selected composition admission, wrong baseline/length/new blob/mode, unknown additions, forbidden root edits, missing authorized paths, HEAD/alternate origins, invented override schema, receipt hash mismatch, altered/extra/missing composed source, full-package README, and public-export refusal. These are 17 data/guard roles, not semantic cases.

The original 36 synthetic controls MUST be replayed with identical fixture/expected-outcome data. Only imports, immutable input location, owned scratch/evidence location and accurate v2 provenance may change in the replay driver. Old captures and the v1 driver remain untouched. The code diff MUST demonstrate that all non-source-admission guard functions and compiler-classifier/worker behavior are unchanged apart from data/import plumbing.

## Conformance Criteria

Author preparation is complete when raw v1 refusal is preserved, the minimal correction and predeclared checks are captured under v2, the unchanged v1 recipe verifies before and after, and explicit-path commits plus a root handoff are sealed. Actual runtime/type/public-package acceptance and independent framework review remain pending. Any additional material guard change MUST stop for a precise proposal instead of silently expanding this correction.
