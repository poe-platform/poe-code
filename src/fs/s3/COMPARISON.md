# Qualified S3 entry comparison

`S3FileSystem.compareEntry` implements the optional contract from `5076b32`
through the shared internal `src/fs/mount/comparison.ts` helper. It resolves fresh
followed views and propagates metadata errors and cancellation. It does not read
object contents, open destinations, lock, copy, publish, or delete. Complete
scoped identities take precedence; unknown remains unknown. The shared helper
owns one-shot authority negotiation and invalid/conflicting answer validation.

## Provider qualification

The shipped mock really owns its bucket maps and stored entries. Its original
implementation and actual bucket map references are privately registered. All
buffered and streaming provider operations must retain their recognized method
references. The existing `createS3Transport(client, capabilities)` factory
preserves qualification only through an intact chain ending in this registered
provider. Wrapping an arbitrary injected client does not qualify it. No new
public registry, permission/trust capability, client token, root export, or
dependency is introduced.

Full-operation binding is required because genuine Mock HEAD responses can be
combined with custom GET/PUT implementations addressing a local source file.
Such a client is **unknown**, not a disjoint remote store. Even a genuinely
transparent hand-written Proxy or method forwarder is unqualified: metadata-only
queries cannot distinguish it from adversarial mixed routing. New distinct client
objects, class/protocol differences, URLs, credentials, bucket names, ETags and
content digests never establish distinctness.

In addition to the full binding, the actual Mock HEAD result receives a private
query-scoped proof referring to the actual bucket map and key. Only the exact
result from the current query qualifies, not manufactured, copied, wrong-key or
replayed earlier-query metadata. The resulting fresh FileStat is privately bound
to its filesystem and normalized path. Method bindings are rechecked after both
peer observations. No identity fields or secret-looking serialized tokens are
added to public metadata. `createS3Transport` naturally preserves the actual
response object. Metadata provenance alone is deliberately insufficient.

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
filesystem/path-bound fresh stat observation with intact full provider mapping.
The shared resolver must obtain fresh metadata on each public comparison; this
helper is not a reusable authorization lease.

A Memory-owned terminal authority may compare its own truly private backing store
against this qualified closed mock store. That owner must establish actual memory
ownership; S3 does not infer it from a complete-looking tuple or another class.
There is no S3-vs-Memory/S3-vs-WebDAV/native-vs-remote blanket distinctness rule.
Arbitrary transports can address local storage, including the source itself.

Public S3 comparison delegates to the common helper. Its registered terminal
callback never calls the peer's compareEntry or recursively negotiates. Wrappers,
their private Memory authority, opaque-wrapper fallback and destination policy
remain the wrapper lead's scope. S3 does not override complete tuples, known
aliases, readonly policies or the conditional copy/PUT/delete protections.

## Acceptance limits and required decision

The original compatibility fixture at SHA256
`9d11741fd9b37757046c1278fdaa00c734633bfd9a1fc58ae479415c2f5a6734`
uses arbitrary opaque clients. Their full operation routing cannot be proved
under the metadata-only contract. No original positive assertion is relaxed or
fixture edited by this leaf. The proposed minimal input qualification is the
already-shipped provider-owned `createS3Transport(service, service.capabilities)`
factory. Root must explicitly approve any positive-fixture input delta, preserving
all required operations and the old fixture/raw denominator; separate qualified
positives are not closure of the original unqualified acceptance gate.

Arbitrary real S3 clients remain usable for ordinary supported operations but
unqualified for this cross-view distinctness proof. A future generic-provider
integration would need provider-owned complete operation mapping and actual
storage/key authority, with independent review; no new public hook is approved
or added here. Same limitations on non-atomic rename, ETag ABA and partial effects
continue unchanged. `tests/fs/s3/comparison.test.ts` includes a genuine-HEAD/local
Memory GET/PUT/stream adversary that must remain unknown with zero content effects.

## Adapter-override safety followup

The `3cf57d3` checkpoint still captured adapter data methods from each constructed
instance. A preconstruction change to the base S3FileSystem prototype could
therefore be mistaken for an original method. Buffered and streamed reproductions
both modified the local source before returning EIO, even with correctly bound
Mock clients. Provider integrity alone was not adapter integrity.

Authority now checks the actual original S3 base implementation descriptors saved
at module initialization, including private stream helpers, alongside unchanged
bound-stream references and the original transport/bucket/prefix configuration.
Subclasses using original data operations remain eligible without a class-based
whitelist. Subclass/prototype/instance data overrides remain unknown unless an
explicit separate comparison authority supplies a valid answer. A custom
compareEntry implementation present at construction is not shadowed by a base
registered callback; common-helper literal/conflict/error validation still applies.

`tests/fs/s3/adapter-overrides.test.ts` asserts actual buffered/streamed source,
sentinel and provider-byte preservation, not only an unknown comparison result.
`tests/fs/s3/authority-safety/REPORT.md` records the baseline loss and fixed
validation, with core `0bee8e7` included in both snapshots. Earlier sealed reports
are historical evidence, not claims that this subsequently found hole was absent.

## Late explicit authority followup

The accepted `37edad8` adapter-integrity fix still registered a terminal callback
that ignored later replacements of `compareEntry`. A late EACCES callback was
never called, allowing a qualified copy to overwrite its existing target. This
was an authorization-error bypass even though the source bytes survived.

The S3 terminal callback now compares each enrolled operand's current method
with the original base method, including instance/prototype changes after
construction. Explicit callbacks run once per distinct S3 operand with their
actual receiver, followed paths, peer and signal. Their answers replace S3's
inferred fallback; missing/unknown explicit authority does not revive that
fallback. Invalid or conflicting answers fail EIO, and real errors/cancellation
propagate before data operations. The common helper still handles other operand
authorities, complete-identity priority and recursive-negotiation suppression.

Constructor-time explicit subclasses use this same terminal dispatch rather than
an unregistered bypass. Original adapter/provider operation checks and the private
`getOwnedS3Entry(view)` descriptor interface are unchanged. No public registry or
shared-helper API change is introduced. `tests/fs/s3/late-authority/REPORT.md`
records the frozen baseline, exact bytes/request effects, failed first validation
and final scoped replay. This does not close the opaque-provider positive gate.
