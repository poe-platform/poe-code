# Trusted provider observations for S3 entry comparison

SDK-like transports without private observation markers may supply the optional
constructor `compareEntry` callback. See `SDK_COMPARISON.md` for the public API,
receiver, explicit-unknown composition and built-in-alias conflict rules, plus
the typed isolated built-package consumer example.

`S3FileSystem.compareEntry` implements the optional contract from `5076b32`
through the shared internal `src/fs/mount/comparison.ts` helper. It resolves fresh
followed views and propagates metadata errors and cancellation. It does not read
object contents, open destinations, lock, copy, publish, or delete. Complete
scoped identities take precedence; unknown remains unknown. The shared helper
owns one-shot authority negotiation and invalid/conflicting answer validation.

## Provider binding and trusted forwarding

The host supplies trusted JavaScript implementations of the declared protocol and
namespace. Root's August 27, 2026 decision removes the extra client-registration
and full-method-fingerprint gate: faithful opaque Proxies, manual forwarders and
`createS3Transport` can preserve a provider-issued entry observation. This is not
a sandbox against a host supplying false namespace assertions. No public registry,
permission/trust capability, client token, root export or dependency is added.

A provider-marked observation describes the actual backing used by content and
mutation operations. Forwarding the exact result preserves that assertion, not
just its metadata values. A gateway using Mock as a metadata cache for unrelated
Memory content must drop the assertion (copying the metadata object does so), or
provide its own truthful identity/comparison. Relaying the Mock binding while
redirecting GET/PUT elsewhere violates this obligation, even when metadata values
coincidentally match. Different client objects, protocols, URLs, credentials,
bucket labels, ETags and content digests still never establish distinctness.

The actual Mock HEAD result receives a private
query-scoped proof referring to the actual bucket map and key. Only the exact
result from the current query qualifies, not manufactured, copied, wrong-key or
replayed earlier-query metadata. The resulting fresh FileStat is privately bound
to its filesystem and normalized path. Transport/bucket/prefix routing checks
remain; client or filesystem method references are not eligibility gates.
No identity fields or serialized tokens are added to public metadata. The private
proof concerns the actual Mock-owned Map, not an arbitrary SDK's HEAD provenance.

For qualified observations, equal actual bucket map plus key means same; different
keys or genuinely separate owned maps mean distinct. Prefixes are incorporated
in the actual queried key, not compared as local filenames. Unknown/unmarked
implicit directory observations remain unknown rather than inventing a backing
marker. The proof is point-in-time evidence, not a cached lease or guarantee about
later pathname changes, ABA, malicious host monkeypatching after observation,
provider authentication, snapshot isolation or atomicity.

## Private wrapper handoff

`getOwnedS3Entry(view)` in the internal `src/fs/s3/authority.ts` returns
`{ storage: object, key: string } | undefined`. `storage` is the actual qualified
mock bucket map, never an invented per-client identity. It accepts only a
filesystem/path-bound fresh stat observation with unchanged transport/bucket/prefix.
The shared resolver must obtain fresh metadata on each public comparison; this
helper is not a reusable authorization lease.

A Memory-owned terminal authority may compare its own truly private backing store
against this qualified closed mock store. That owner must establish actual memory
ownership; S3 does not infer it from a complete-looking tuple or another class.
There is no S3-vs-Memory/S3-vs-WebDAV/native-vs-remote blanket distinctness rule.
Arbitrary transports can address local storage, including the source itself.

Public S3 comparison delegates to the common helper. Its terminal authority
handles explicit S3 operand callbacks once each, without recursive negotiation. Wrappers,
their private Memory authority, opaque-wrapper fallback and destination policy
remain the wrapper lead's scope. S3 does not override complete tuples, known
aliases, readonly policies or the conditional copy/PUT/delete protections.

## Acceptance and remaining SDK limitation

The original compatibility fixture at SHA256
`9d11741fd9b37757046c1278fdaa00c734633bfd9a1fc58ae479415c2f5a6734`
uses faithful opaque clients. No fixture/input qualification change is needed or
made. The bounded replay restores the five previously failing S3 existing-target
workflows: one-mount copy, separate-client copy, cross-mount mv and both Memory
copy directions. Exact counts and frozen old/new evidence are recorded in
`tests/fs/s3/trusted-observation/REPORT.md`; this is not the entire original gate.

Real SDK or serialized responses without recognized identity or a truthful
constructor comparison callback remain unknown for cross-view existing-target
comparison, even when fully protocol-compliant. Automatic real-provider identity
discovery remains open; the constructor option supplies the existing filesystem
comparison signature, not a public identity registry. Non-atomic rename, ETag ABA
and partial-effect limits are unchanged. The historical mixed-routing adversary
is preserved and classified as a false-binding host, not a compliant-provider
pass. Its revised compliant cache control drops the false binding and preserves
Memory source bytes with zero content effects.

## Historical adapter-override safety followup

The `3cf57d3` checkpoint still captured adapter data methods from each constructed
instance. A preconstruction change to the base S3FileSystem prototype could
therefore be mistaken for an original method. Buffered and streamed reproductions
both modified the local source before returning EIO, even with correctly bound
Mock clients. Provider integrity alone was not adapter integrity.

At `37edad8`, authority checked the actual original S3 base implementation descriptors saved
at module initialization, including private stream helpers, alongside unchanged
bound-stream references and the original transport/bucket/prefix configuration.
That method-reference eligibility was subsequently removed under the approved
trusted-host rule: a faithful filesystem decorator must preserve the same fresh
observation even when its function reference differs. Data remappers must omit or
replace inherited binding themselves. Explicit comparison dispatch and common
literal/conflict/error validation remain required.

`tests/fs/s3/adapter-overrides.test.ts` asserts actual buffered/streamed source,
sentinel and provider-byte preservation, not only an unknown comparison result.
`tests/fs/s3/authority-safety/REPORT.md` records the baseline loss and fixed
validation, with core `0bee8e7` included in both snapshots. Earlier sealed reports
are historical evidence, not claims that this subsequently found hole was absent.

## Late explicit authority followup (retained)

The accepted `37edad8` adapter-integrity fix still registered a terminal callback
that ignored later replacements of `compareEntry`. A late EACCES callback was
never called, allowing a qualified copy to overwrite its existing target. This
was an authorization-error bypass even though the source bytes survived.

The S3 terminal callback now compares each enrolled operand's current method
with the original base method, including instance/prototype changes after
construction. Explicit callbacks run once per distinct S3 operand with their
actual receiver, followed paths, peer and signal. Their answers replace S3's
inferred fallback; missing/unknown explicit authority does not revive that
distinct fallback. Fresh built-in same remains a safety guard: an explicit distinct
answer conflicts with it and fails EIO. Invalid or conflicting answers fail EIO, and real errors/cancellation
propagate before data operations. The common helper still handles other operand
authorities, complete-identity priority and recursive-negotiation suppression.

Constructor-time explicit subclasses use this same terminal dispatch rather than
an unregistered bypass. Actual routing checks and the private
`getOwnedS3Entry(view)` descriptor interface remain. No public registry or
shared-helper API change is introduced. `tests/fs/s3/late-authority/REPORT.md`
records the frozen baseline, exact bytes/request effects, failed first validation
and final scoped replay. Those historical results do not claim current full-gate closure.

## Faithful filesystem decorators

The `91d5926` transport-forwarding fix still rejected a faithful
`filesystem.readFile = filesystem.readFile.bind(filesystem)` decorator. The bounded
followup removes only filesystem function-reference eligibility; it retains the
actual transport/bucket/prefix routing, current provider-query proof and FS/path/stat
binding. The original compareEntry reference remains solely for dynamic explicit
callback dispatch. Buffered, streamed, metadata and subclass forwarding are tested
with real distinct-target copies, alias preservation and exclusive-create errors.

A remapper must not reuse an unrelated provider's marked stat. Likewise, a cache
must not present an old marked stat as a fresh observation: it must drop the private
binding (returning a copied stat does so) or obtain fresh truthful authority. The
private descriptor is not an age/lease oracle or a sandbox against lying host JS.
`tests/fs/s3/faithful-decorators/REPORT.md` retains the exact valid-refusal baseline,
old redirect/stale-cache inputs and their observed effects, plus the intentional
compliant-input classification delta. No original compatibility fixture is changed.
