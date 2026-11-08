# Bounded S3 authority checkpoint — August 27, 2026

## Delivered and not delivered

Permission policy is the separate atomic commit `d25cb3f`, authorized by contract
`5076b32`. It changes the active S3 generic-row expectations, not product permission
enforcement. Historical `d0948bb`, the four-reds evidence, 98/99 and old fixture
copies remain byte-identical. No original compatibility expectation is changed.

The source checkpoint implements `S3FileSystem.compareEntry` against the wrapper
lead's private helper, including its `e8d308a` opaque-forwarding correction. It
requires full provider-owned operation mapping and supplementary fresh metadata
proof. Direct actual MockS3Client and intact existing createS3Transport chains can
prove same/distinct storage. Arbitrary opaque clients remain unknown. This is a
safe qualified implementation, **not closure of the original acceptance gate**.

No contracts, root exports, commands, other backends, wrapper source, independent
policy tests, or original compatibility fixtures are edited by this leaf. The
wrapper lead retains comparison negotiation, readonly/view routing and any future
private Memory-owned authority. No new public API/registry, trust flag, per-client
identity or runtime dependency is added. Conditional copy/PUT fallback/delete and
rename algorithms are unchanged.

## Safety correction

The initial uncommitted implementation attempted to derive closed-store authority
from current-query genuine Mock HEAD objects. That was insufficient: a client can
forward genuine HEAD while routing GET/PUT/streams to a local Memory source.
Treating it as disjoint can authorize source-damaging writes. Root identified this
information gap before any authority source commit.

`rejected-head-only-source.json` preserves that rejected attempt's exact source.
`authority-first-original-gate.json` preserves its original-fixture 12/15 run.
Those passes are an **unsafe trial, not accepted functionality or final evidence**.
The historical alias failure in that trial was helper recursion EIO, not a proven
alias EINVAL ruling. The wrapper owner fixed it separately; this leaf edits no
helper or negative expectation.

The final implementation requires all eight buffered/streamed operation references
and every createS3Transport forwarding link to retain the registered provider
mapping. The Mock's original implementation methods, internal helpers and actual
bucket-map reference are checked too. Real returned HEAD objects are merely an
additional current-query witness. Fresh filesystem/path-bound stat observations
and operation binding are revalidated after peer metadata work. Copied, fabricated,
replayed, wrong-key or unqualified metadata cannot supply a closed-store proof.

The focused adversary uses genuine HEAD from Mock but GET/PUT/stream operations
addressing the local Memory source. Its descriptor is undefined, comparison stays
unknown, and mounted copy rejects ENOTSUP with **zero GET/PUT/stream effects**,
exact local bytes and namespace preserved. The outer createS3Transport wrapper
does not bless the partially rerouted inner client. All eight method-substitution
tests, preconstruction implementation override, changed-between-peer-query and
cached/copied/path-poisoned stat controls pass.

The separate new comparison test's first author run had a missing closing brace;
that loader error was corrected before behavioral validation. It was not a source
failure. The prior permission test's root-path assertion correction remains in
`approved-policy-validation.json`. Neither author error is counted as acceptance.

## Final recorded validation

`authority-bound-validation-01.json` records exact argv, raw output, subprocess
exits, full source/input hashes before and after, source patch/new files, versions,
and both handoffs. Baseline HEAD was `e8d308a11bf562efcfba1d8a861503883b4952a3`;
owned S3 code was uncommitted during validation. Every recorded input stayed
byte-identical across the run. This is a hashed worktree checkpoint, not a claim
that bare baseline HEAD contains the candidate. Node was 22.22.2; exact tooling
versions are in the record. No full-repository tests, build or global types ran.

| Cohort | Result |
| --- | --- |
| New full-binding comparison/safety tests | 29/29 |
| S3 backend, including those new tests | 208/208 |
| S3 conformance | 50 behavior + 2 provenance, all pass |
| Independent S3 policy, read-only | 86/86 |
| Separately approved permission profile | 7/7 |
| Targeted S3 adapter stress | 37/37 |
| Strict scoped source/backend/profile types | exit 0 |
| Original unchanged S3 compatibility subset | **11/16, five RED** |

All test cohorts have zero skips, cancellations and TODOs. Comparison29 is included
in backend208; do not sum them as independent tests. Original S3 subset16 contains
14 positive operation cases plus two controls: **9/14 positives and 2/2 controls**.
It is a subset of the original 43-case fixture (38 positives plus five controls),
not a rerun or replacement of the full denominator.

The original fixture remains SHA256
`9d11741fd9b37757046c1278fdaa00c734633bfd9a1fc58ae479415c2f5a6734`.
The five unchanged required RED cases are:

1. S3 one-mount copy, target existing.
2. S3 separate-clients copy, target existing.
3. S3 separate-clients cross-mount mv, target existing.
4. Memory to-remote S3 copy, target existing.
5. Memory from-remote S3 copy, target existing.

All remain honest ENOTSUP rather than destructive guesses. The original opaque
filesystem alias control now passes its unchanged ENOTSUP/byte assertions under
the wrapper owner's correction. The default-rename limit control also passes.
New qualified alias tests use EINVAL based on actual shared authority; no original
unqualified negative is relabeled.

## Precise root decision and dependency

Metadata-only observations cannot prove that arbitrary manual forwarders map all
future GET/PUT/copy/delete/stream operations to the service returning HEAD. Full
binding cannot be inferred from bound functions, metadata provenance, URL, class,
bucket label, credentials, ETag or content. The mandatory original fixture uses
exactly such arbitrary Proxy clients; making their existing-destination positives
green automatically would contradict the mixed-routing safety requirement.

The minimal available qualification uses the **existing** provider-owned factory:
`createS3Transport(service, service.capabilities)`. No new factory API is needed.
Root must explicitly decide whether the positive fixture input may be changed to
that qualified factory while retaining all 38 required operation expectations,
the original input/raw 43-case evidence and unqualified adversarial controls.
This leaf neither makes that unowned input delta nor counts its own qualified
positives as equivalent acceptance. The question was published early in
`/tmp/safe-bash-s3-authority-handoff.txt` and is preserved in the validation record.

Even with qualified S3 input, mixed Memory/S3 positives also require the wrapper
lead's actual private Memory-owner callback. It may recognize only the validated
`getOwnedS3Entry(view)` descriptor, never a type/protocol separation. No such
Memory callback is included or assumed by this S3 checkpoint. The wrapper handoff
explicitly records that dependency.

Ordinary supported operations on arbitrary injected S3 clients remain available;
only unproven cross-view distinctness remains unavailable. This does not certify
universal real-S3 provider identity, IAM permissions, ABA defense, pathname leases,
snapshots, transactional copy/rename, full interoperability or product completion.

## Replay

Replay each recorded argv against the recorded source patch/new files and matching
dependency hashes, or run
`node tests/stress/adapters/s3-permission-profile/validate-authority.mjs new-label`.
The runner refuses to overwrite evidence and returns nonzero while an original
required case fails. The two temporary handoff inputs are recorded verbatim in
the JSON; individual test commands have no handoff-file dependency. New authority
artifacts are sealed separately in `BOUND-AUTHORITY-SHA256SUMS`; historical seals
are neither regenerated nor expanded to pretend the earlier RED checkpoint passed.
