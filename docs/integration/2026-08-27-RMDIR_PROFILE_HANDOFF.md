# Rmdir profile contract handoff

August 27, 2026. Root supplied the policy decision; Curie implements the minimal
shared clarification, not a separate approval gate. Poincare owns backend source
and service evidence. This handoff does not implement or accept positive S3/WebDAV
rmdir and does not change an existing fixture expectation.

## Exact additive API

`FileSystemCapabilities.snapshotRmdir?: boolean`, exported through existing
contract/root type exports. `FileSystem.rmdir?(path, options?: FsOptions)` and
`rm` signatures are unchanged. No new per-call option, method, enum, transport
capability, callback signature, dependency or automatic wrapper behavior is added.

- `true`: supported calls may use the explicit snapshot-empty-marker profile.
- `false`/omitted: existing removal-time empty-directory contract remains in force.
- Neither value guarantees method presence or support on every path.

The previous `1dc0652` wording did **not** already permit snapshot-marker success:
it required removal-time emptiness and unchanged namespace on ENOTEMPTY. A
backend README alone could not amend that contract. The additive declaration and
normative section in `src/contracts/filesystem.md` qualify both requirements
explicitly, without weakening memory/real operations or silently allowing arbitrary
remote recursive deletion. Backend exposure/configuration must disclose the profile;
this contract does not invent or select an unfinished S3 constructor option.

## Required backend implementation boundary

Implement marker-only removal only for an unambiguous explicit directory marker
after the required complete emptiness observation. Observed children/nested markers
mean ENOTEMPTY with no mutation; files, missing paths, roots, readonly, permission,
cancel and malformed/incomplete provider responses retain meaningful errors.
Delete exactly the marker key and **never a descendant**. Success can leave a
logical directory visible if a child arrived after inspection. Do not delete that
child, hide it through a wrapper, claim rollback, or report an unmodified ENOTEMPTY
after marker mutation. Same-key/same-content ABA is not solved. Actual verified
marker conditions can improve protection but do not assert prefix emptiness.

The author must set the public declaration before exposing this behavior. Mounts
must propagate the weaker supported profile or refuse the delegated operation;
strict routed paths keep their stronger behavior. Readonly refusal remains valid.
Overlay forwarding/whiteout publication needs its own no-hidden-descendant proof;
merely setting a boolean does not establish it. Existing consumers still call
`rmdir`, never a recursive fallback. The current wrapper implementations were read
only; this contract commit does not silently patch them or certify their readiness.

WebDAV default remains refusal without an atomic server-side empty-directory
primitive. The root approved investigation of an explicit truthful host-adapter
extension, **not** collection DELETE under a depth-infinity lock. The native child
loss in `ff345b7` remains a real feasibility counterexample. Finite expiry and
pending deletion after cancellation are not a basis for a recursive exception.
No speculative public callback type or unfinished WebDAV implementation is added.

## Evidence retained and next verification

- S3 author `329eb27`/`775a118` reports no implemented positive rmdir, a measured
  marker deletion that preserves children yet leaves the logical directory visible,
  same-ETag marker ABA, and a MaxKeys=1 provider listing discrepancy. The separate
  final19/20 author cohort is not changed to green by this contract.
- Original adapter workflow matrix at `9ba94f5` remains **77/79**. A future S3
  improvement requires a new public built-package replay and separate independent
  review; it is not inferred from native DELETE or this declaration. Any changed
  provider configuration/input must be disclosed alongside the original cohort.
- WebDAV `ff345b7` native locked DELETE destroys a newly created child. Public
  rmdir still refuses. A future atomic-primitive profile needs its own positive,
  native/alias writer, expiry/cancellation, error and child-preservation evidence;
  it cannot be counted as stock-server support.
- Separate completed reviews remain distinct: canonical FS reconciliation
  `ad837f1` and recognized WebDAV LOCK-scope fix review `5216aef` of source69672fe.
  Neither review accepted rmdir or certified arbitrary providers.

Author regression requirements: exact-key wire assertions (no batch/descendant
delete), nested child insertion after observation, readonly/root/literal paths,
paginated/nonempty/incomplete listings, abort before and during issued deletion,
provider error propagation, marker replacement/ABA characterization, mount profile
visibility and overlay no-hidden-child controls. Validate ordinary quiescent Shell
`rmdir`/`rm -d` and retain all old failures separately. Different-agent verification
must follow implementation; this is a contract/type checkpoint only.

Primary protocol references reviewed August27: AWS S3 API `DeleteObject` describes
one addressed key and versioning/conditional behavior; it does not establish a
prefix-emptiness predicate. RFC4918 section9.6.1 collection deletion does not supply
an atomic empty-only primitive. The pinned MinIO observations are not universal
AWS or arbitrary S3-compatible service claims. No protocol fact is used to erase
the recorded provider mismatch or child-loss counterexample.

## Contract-only checks

At 2026-08-27T07:06:47Z, the focused filesystem contract suite passes4/4 and the
live scoped `npm run test:contracts` suite passes89/89, zero failures/skips/TODOs.
The4 are included in89, not an additional unique cohort. Strict standalone
TypeScript checking of `tests/contracts/filesystem.test.ts` exits0 with
NodeNext/ES2023, strict, noUncheckedIndexedAccess and exactOptionalPropertyTypes.
The tests preserve the optional signal-only method, required rm signature,
readonly optional boolean declaration and existing boolean capability extensions.
They do not claim marker-removal behavior, wrapper readiness or service acceptance.
No global build/full-suite gate or cold configuration change was attempted.
