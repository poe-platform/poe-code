# Trusted S3 provider observations: bounded implementation checkpoint

August 27, 2026. User-approved implementation under contract `cd8b5c8`, which
adds faithful-forwarding obligations to the existing `5076b32` comparison API.
Only S3 source, backend tests and this new evidence directory are changed.
Dirac's `tests/fs/authority-trust-review/**` is not edited, staged or executed.
No contracts, core commands, other filesystem, root export or public API changes.

## Actual result and unchanged original inputs

The original compatibility fixture is unchanged at SHA256
`9d11741fd9b37757046c1278fdaa00c734633bfd9a1fc58ae479415c2f5a6734`.
Its S3 selection (`--test-name-pattern=s3|S3`) improves from **11/16 to 16/16**.
This selection contains 14 positive workflows and two guards. Exactly the five
previously failing required existing-target cases now succeed:

- `REQUIRED s3 one-mount copy, target existing`
- `REQUIRED s3 separate-clients copy, target existing`
- `REQUIRED s3 separate-clients cross-mount mv, target existing`
- `REQUIRED memory to-remote s3 copy, target existing`
- `REQUIRED memory from-remote s3 copy, target existing`

The original test asserts actual source/target/sentinel bytes and namespace
effects. Neither its inputs nor positive expectations nor its opaque-filesystem
alias guard is changed. Its S3 alias ENOTSUP guard and default-rename ENOTSUP
guard pass unchanged. Restoring these five cases is not a fresh full38/38 claim:
the two Memory/WebDAV failures in the historical31/38 belong to another owner.
The old original31/38, qualified-mock38/38, rejected HEAD-only trial and recorded
source corruption remain historical evidence, not rewritten observations.

## Source change and trust boundary

The old provider registry required recognition of every client-operation method
and a chain to a directly registered Mock client. It rejected faithful opaque
Proxies and manual forwarders even when the actual provider observation survived.
That extra registry, client method fingerprint and registration calls are removed.
The actual Mock HEAD still emits a private query-scoped observation of its actual
bucket Map and canonical key. Current-query matching, exact output-object proof,
filesystem/path/stat binding and stock-adapter observation checks are unchanged.
No identity is manufactured from clients, URLs, bucket labels, protocols or ETags.

`getOwnedS3Entry(view)` retains exactly `{ storage: object, key: string } | undefined`.
The existing Memory-owned consumer can therefore recognize the actual closed Mock
store through faithful forwarders without a Memory edit. Distinct actual Maps
are separate Mock stores; matching Map/key is an alias, including across prefixes
and clients. Copied, manufactured, wrong-key, unbound and replayed observations
do not become authority. Complete known IDs and late explicit comparison
callbacks retain priority and their existing error/conflict/cancellation handling.

Host-supplied JavaScript must preserve the asserted content-operation namespace.
A gateway using Mock only as metadata for local Memory must drop the Mock entry
assertion or publish actual Memory identity. Retaining that false assertion while
redirecting GET/PUT is a host-contract violation. Successful execution of that
invalid host is NOT counted as a compliant-provider pass. Method fingerprints
cannot sandbox malicious host code. Existing stock S3 adapter checks remain a
conservative observation path, not a universal malicious-host security claim.

Direct copy/rename conditions, conditional PUT/copy/delete policies, races,
read-only policy and advisory-mode rules are not changed. The policy86 replay is
read-only. No rmdir, SGID, dependency, native product process or public binding API
is introduced. Generic real SDK and serialized-response identity remains OPEN.

## Intentional test-classification delta

`old-comparison.source.txt` is the exact pre-change comparison test, also embedded
in `before.json`. `classification.json` records exact old/new case IDs and hashes.
The source-only replay runs those OLD assertions unchanged: **62/75**, with all
13 old-profile disagreements retained in `after-source.json` before revising tests.
Those 13 cases are not hidden by skips, TODOs, filters or deleted assertions:

| Old cases | Count | Intentional new classification/expectation |
| --- | --- | --- |
| Manual opaque forwarding is unqualified | 1 | Faithful fresh binding proves same actual entry, not unknown |
| `changing <operation> invalidates the complete forwarding mapping` for all eight operations | 8 | Replacing a method with a faithful bound provider method preserves same entry |
| Provider substitution before construction | 1 | A faithful forwarding implementation preserves same entry |
| Operation binding checked after peer metadata | 1 | Faithful replacement during that query preserves distinct actual stores |
| Unqualified opaque-client alias copy | 1 | Fresh proof establishes same: EINVAL replaces ENOTSUP; bytes and zero-effects assertions remain |
| Genuine Mock HEAD plus local Memory GET/PUT | 1 | Old input falsely asserts Mock ownership; revised compliant cache explicitly copies HEAD metadata to drop that assertion, retaining all source-preservation/no-GET/no-PUT assertions |

Three additional existing route labels change from “full mapping” to “fresh
provider” authority without changing their assertions. All29 comparison cases
remain active. The unchanged13 adapter-override and33 late-explicit tests remain
active too; their conservative guards are not offered as the new host trust model.
The historical false-binding input is preserved verbatim, not reported as a
new compliant positive. Independent tests and their historical expectations are
not altered by this classification.

Seven additional author regressions cover plain Proxy/manual forwarding and both
through createS3Transport, shared-Map prefix aliases plus real existing-key copies,
unbound HEAD metadata, and a legitimate Memory-backed gateway with actual Memory
scoped identities versus no binding. Both gateway profiles preserve actual aliases;
only the profile exposing the real Memory tuples copies a proven distinct target.
The unbound gateway stays unknown and effect-free. These are bounded author tests,
not Dirac's independent acceptance gate.

## Captures and final validation

All JSON captures include exact source/test snapshots, input SHA256 manifests,
commands, raw stdout/stderr, status and current worktree state. All have zero
changed inputs during their individual commands and include core `0bee8e7`.
The baseline is HEAD `916fbb4eae610752f34ec25354f6bc2dff28925b`; the final snapshot
is `42baad36ecc603a918e57766bbccef893ab0171b` plus this recorded owned patch.
Curie's contract was committed between baseline and source-only replay; the exact
old/new contract text and hashes are captured. No clean-whole-product claim follows.

| Capture | Authority | Original S3 | Other results |
| --- | --- | --- | --- |
| `before.json` | 75/75 old tests | 11/16 | Frozen pre-change source and expectations |
| `after-source.json` | 62/75 old tests | 16/16 | 13 explicit profile disagreements preserved |
| `classified.json` | 80/82 | 16/16 | New gateway fixture omitted required LIST sizes |
| `final.json` (first full attempt) | 80/82 | 16/16 | Gateway slash-marker HEAD incorrectly surfaced Memory ENOTDIR; backend259/261, policy86/86, conformance52/52, types0 |
| `replay-final.json` | **82/82** | **16/16** | **backend261/261, policy86/86, conformance52/52, strict scoped types exit0** |

Gateway fixture corrections add actual LIST sizes and S3 NoSuchKey for absent
slash-marker objects. No production change was needed for those two author-fixture
failures. The 52 conformance count is 50 S3 cases plus two provenance checks.
Authority82 is included in backend261; do not add those as disjoint totals.
Every final test cohort reports zero failures/cancellations/skips/TODOs.

| S3 source | Before SHA256 | Final SHA256 |
| --- | --- | --- |
| authority.ts | `102a8ada61020ff65d3617cdd60fca350bff3e99f287fc0696ece04aac32b229` | `78fb41e8a54de13a1b3114051c71949cbb2830a9508e1d6cd5b75515c6d0d29f` |
| filesystem.ts | `97f91913c3b2a9916218776d286eeaf25928d3aebbe3df60f0bf2d24d1635f6f` | `45cec66e7569e93076e0476e9e8e743644283cf9bc89193f3801a0e5fb790dba` |
| mock.ts | `f80eb6ac65477d7cbfd1083a00cb8c5043ba594b0fd07cf167d698b7c6905821` | `99655664c7a52c595dc1ec4e5d461e4c002a0c9ba60d222ded078e5b9780841e` |
| transport.ts | `df111b273073bcbebc8be0648027211e545af7fcd00561057f4da0665683b9fe` | `185895f1b939370903c9a896df47a1066647a50eb3022e1d0387918996ccd51c` |

Replay with `node tests/fs/s3/trusted-observation/validate.mjs replay-unique-label`;
existing evidence cannot be overwritten. `SHA256SUMS` seals all new artifacts and
final owned source/test/docs. `d25cb3f`, earlier safety/late-authority evidence and
the existing policy-profile evidence remain byte-identical. All launched checks
finished; independent trust review remains required before broader acceptance.
