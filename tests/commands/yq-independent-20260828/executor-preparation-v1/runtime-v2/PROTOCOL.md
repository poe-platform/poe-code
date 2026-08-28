# YQ Runtime v2 Corrective Addendum Specification

Status: Accepted synthetic-only corrective protocol; actual review remains gated

Implemented Through: `c49d494dd5a36b19198680239a72e0c95cb90d8d`

Purpose: Correct independently frozen F01/F02 and one selected-candidate harness
import incompatibility without replacing the original executor contract.

## Normative Language

MUST and MUST NOT identify conformance requirements. This August 28, 2026
addendum incorporates the original runtime protocol at
`0f138190073cb5419aa86c63e0a10075fe67f88f`. It overrides only the behavior
explicitly identified here. Implemented Through identifies the inspected v1
source, not verification of these new requirements. The separate source preseal
and later replay evidence MUST identify the exact corrective implementation.

## Problem Statement, Goals and Non-Goals

The independent review at `b93241dfb9983d2b660233bdddce4569ec803f89` preserves
F01: an unbound assertion becomes PASS; and F02: distinct objects lose identity.
The executor MUST preserve those raw failures, input mutations and expectations.
The goal is a narrow additive repair, not a YAML implementation, lifecycle
acceptance, production-policy change, or a new proof of natural-language claims.
This work MUST NOT import, build, typecheck or execute product/private code or
native YAML. Synthetic framework passes MUST NOT become semantic passes or GO.

## System Boundary and Domain Model

The v2 recipe is a deterministic delta over eleven authenticated v1 recipe
components at the implemented-through commit, also checked against
`ee9d0c1fd24b33aa918154eb379a92c02cfe5925`. Only assertion capture, reason
encoding, the import allowlist and its selected-candidate authorization pin
change. The original host, child, fixture materializer, execution entry,
integrity helper, inventory and source bindings MUST remain byte-identical.
The repository MUST store deltas and authentication, not a second copied
framework. An explicit materialization MAY publish the complete composed recipe
to a fresh regular directory for the existing execution interface.

A projection is the original bounded byte/status/event check. An obligation is
an expected field, explicit assertion or missing proof binding. Identity is an
opaque scope/token pair for a reference observed by one encoder in one child.
The original 194-ID inventory and seven per-role denominators MUST remain
unchanged. Full-record eligibility metadata MUST NOT itself constitute evidence.

## Assertion Contract and State Transitions

The host MUST persist raw child bytes, child status and integrity/reap boundary
before receipt assertions. Valid captured command bytes MUST be persisted before
the obligation audit. The audit MUST publish `obligations.json` before throwing
for unfulfilled obligations; a failure MUST remain an aggregate FAIL in the
unchanged host. Ordinary assertion failure MAY continue only after both original
integrity and known-child/group reap checks pass.

The narrow supported expected fields are status, stdoutHex, stdoutUtf8, reads,
documents, diagnosticCode and the original three effect profiles. Empty
`assertions: []` adds no obligation. Every nonempty assertions entry, malformed
assertions value, unknown expected field, inapplicable document projection,
unknown effect profile, malformed supported value, frozen missing binding, or
explicit partial-record marker MUST fail or remain recorded incomplete, never
PASS. This implementation chooses FAIL with an INCOMPLETE obligation artifact.
Structured legacy aliases such as stdout/stderr/diagnostic and private numeric,
query/count/frame claims are deliberately unbound here; the original bytes
remain preserved. No natural-language text is matched to a pretend predicate.
Even a successful audit is only BOUND_PROJECTION_ONLY and MUST NOT claim a
full-record semantic pass. The original byte/status/diagnostic checks still run.

## Rejection Identity Contract

Within one observed child encoder, repeated encoding of the same object or
function MUST retain the same scope/token; distinct references with identical
printed properties MUST receive different tokens. Command rejection and fixture
cleanup capture MUST use the same default encoder. Undefined, null, booleans,
strings, numbers and bigints MUST retain their kind; negative zero MUST remain
distinct from zero. Distinct symbols with equal descriptions MUST not collapse.
JSON serialization MUST preserve this evidence. Hostile descriptive properties
MUST NOT erase reference identity; an unprintable description MAY be marked.
Tokens from separate encoder scopes or processes MUST NOT be compared as object
identity. The recipe grants no cross-process identity, object lease, concurrent
mutation safety, or product cancellation/lifecycle acceptance.

## Selected Import Compatibility and Configuration

Only `node:timers/promises` is added to the existing candidate builtin allowlist.
The recipe MUST pin candidate `35da18547ca82a67be9ca22b4adc21e3b8060780` and
retain the original CARRY contract `bd471ef682d768692a682d40009a874f51e3ad68`.
The static admission finding at `71a16afd5b430175180fc4741531b75c31b25882`
and the selected query adapter's static import MUST be authenticated as data.
The old fence MUST still refuse this builtin; other builtin, package, network,
path-escape and symlink denials MUST remain intact. The source projection remains
271 files; the separate 273-file full archive is preserved data, not substituted
for the selected source. This harness change MUST NOT broaden production policy.

## Failure Model, Recovery and Safety

Nonzero exit, signal, timeout, overflow, malformed receipt, assertion failure,
integrity change and absent reap proof MUST retain original failure semantics.
Integrity/reap uncertainty MUST stop subsequent admission. Authentication MUST
use exact commits, Git blobs/modes and SHA-256 before importing composed helpers.
Preseal MUST bind the version, source files, controls, recipe and exact diff
before synthetic replay. Each replay MUST use unique no-clobber evidence and
bounded children/output. Post-run recipe guards MUST enumerate additions as
well as original files; authentication of other referenced historical files is
selected-path integrity, not an append-proof repository or transient-write proof.
All mutation controls MUST operate on owned synthetic copies only.

## Integration Contract

`recipe.mjs` exports `describeRecipe()`, `materializeRecipe(destination)` and
`verifyRecipe(recipeRoot)`. Materialization returns recipeRoot, seal, sealPath
and sealSha256. The resulting `host.mjs`, `assert-capture.mjs`, `context.mjs`,
`import-fence.mjs` and deferred `execute.mjs` retain v1 call signatures; context
also exports `createRejectionEncoder()`. Consumers MUST authenticate the source
preseal and recipe seal using independently routed hashes before importing this
API. Actual execution STILL requires the original explicit root authorization,
source/build attestation, exact selected jobs and physical source/compiled roots.
This addendum, recipe seal and synthetic receipts MUST NOT supply that authority.

## Test and Validation Matrix

| Contract | Required synthetic evidence |
| --- | --- |
| F01 | Exact frozen mutation: v1 raw PASS retained, v2 FAIL, valid continuation |
| Unknown/partial obligations | Malformed, unknown, natural-language, private, inapplicable fields refuse; empty obligations retain projection control |
| F02 | Same/distinct objects, function/symbol references, primitives, actual fixture cleanup, JSON roundtrip |
| Fence | Original refusal, new timer static import, unchanged other denials and selected-candidate pin |
| Host | Raw-before-assert, nonzero/signal/deadline/overflow failures, ordinary continuation, integrity and reap stop gates |
| Authentication | Exact unchanged components, recipe/diff/source hashes, mutation/addition detection and no-clobber publication |
| Inventory | Independent seven-role counts, 194 IDs, 132 prepared IDs, unchanged materialized job hash |
| Scope | Zero product imports/builds/types/native YAML/private work and zero semantic passes |

## Conformance Criteria and Open Questions

Conformance requires the presealed synthetic matrix and a separate verifier's
replay; author controls alone are not independent acceptance. The source commit
and evidence commit MUST remain distinguishable. No unresolved product-policy
question is introduced. Actual review, declarations, source instrumentation and
GO remain external gated work; this addendum grants none of them.
