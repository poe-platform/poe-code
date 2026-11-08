# Internal entry comparison

This module consumes the approved `FileSystem.compareEntry` contract. It is an
internal filesystem implementation seam, not a public registry or root export.
S3/WebDAV implementations import `../mount/comparison.js`; wrapper registration
and negotiation use the same module-private WeakMaps.

```ts
interface EntryLocation {
  readonly filesystem: FileSystem;
  readonly path: string;
  readonly readOnly?: boolean;
  readonly stat?: FileStat;
}
interface EntryView extends EntryLocation {
  readonly stat: FileStat;
  readonly readOnly: boolean;
}
type EntryViewResolver = (path: string, options: FsOptions) => Promise<EntryLocation>;
type EntryAuthority = (own: EntryView, peer: EntryView, options: FsOptions) => Promise<EntryComparison>;
registerEntryView(fs: FileSystem, resolver: EntryViewResolver): void;
registerEntryAuthority(fs: FileSystem, authority: EntryAuthority): void;
resolveEntryView(fs: FileSystem, path: string, options?: FsOptions): Promise<EntryView>;
compareResolvedEntries(own: EntryView, peer: EntryView, options?: FsOptions): Promise<EntryComparison>;
compareEntries(fs: FileSystem, path: string, peer: FileSystem, peerPath: string, options?: FsOptions): Promise<EntryComparison>;
```

Trusted wrapper resolvers return their immediate backing filesystem and path.
Readonly accumulates across the chain; cycles fail `EIO`. The optional terminal
stat snapshot represents a real trusted observation, including mount's synthetic
directory (which has unknown identity); it is not a newly fabricated backend.
Ordinary terminal providers omit it and receive `realpath` followed by `lstat` of
the followed entry. This preserves the observed named metadata rather than
replacing incomplete `lstat` identity with unrelated `stat` fields. A final
symlink appearing at the resolved location fails `EIO`, not a link-as-file proof.

Complete valid scoped tuples win before authority queries. Otherwise each
distinct registered authority callback is queried at most once, in operand order.
Sharing a callback reference means sharing an operation authority, not globally
disjoint storage. Both answers are checked: invalid/conflicting results fail
`EIO`. Unrecognized peers stay unknown. Errors and cancellation propagate.
Neither observations nor results are cached across operations.

A provider implementing public `compareEntry` via `compareEntries(this, ...)`
registers a terminal callback during construction. That callback must not invoke
comparison methods recursively. Unregistered external providers can supply a
one-shot terminal `compareEntry`; they are not implicitly trusted wrappers.
Nested helper negotiation returns `unknown` before further metadata or authority
queries, rather than recursively resolving peers. An opaque forwarder of a
negotiating public method is therefore unsupported, not an invalid answer.
Opaque adapters that forward a negotiating method without trustworthy view
registration do not acquire authority through their shape or constructor.

Memory publishes per-store complete identity; real publishes actual safe native
IDs in the agreed global native scope. Memory also registers a terminal authority
for its constructor-owned store, requiring an original implementation and a fresh
filesystem/path/root-bound observation. It accepts only the internal S3/WebDAV
owners' full-operation-qualified closed mock descriptors, not response provenance
alone. Those stores are distinct from its own private storage. Manual forwarding
clients, native peers and other unknown remote mappings remain unknown. No new
identity token or public registry is involved. Remote callbacks must use
native/provider-owned or mutually recognized authority. Distinct clients,
protocols, URLs, keys, ETags and tokens
alone are not disjointness proof; a custom remote transport can access local
storage. Provider-specific metadata maps may support recognition but must not
duplicate the wrapper-view registry or relabel backing entries.

Memory also withholds `identityScope` when the original backing implementation
or root no longer matches. Otherwise an inherited stat tuple could bypass all
callbacks even though a subclass or patched streaming operation accesses another
store. Original method references are captured at module initialization, not from
an already-overridden instance in its constructor. This is a current binding
check, not protection against later arbitrary host monkeypatching or a lease.
An unchanged inherited implementation is eligible; constructor/class names do
not establish backing ownership. An explicit comparison override present during
construction is left to the normal one-shot external authority path rather than
silently shadowed by Memory's default callback registration.

Resolution and callbacks are metadata-only: no source body, destructive open,
copy-up, cleanup, lock-null resource or publication. Overlay resolution describes
its selected read view; copy guards inspect the actual destination independently
inside its mutation queue. The immutable-lower/exclusively-owned-upper
prerequisites still apply. Readonly results do not grant write permission.

This is point-in-time evidence, not a lease, ABA defense, provider authentication,
conditional deletion or pathname-race guarantee. Default opaque-client fixtures
without usable provider authority cannot be made distinct by guessing; their
remaining proof-hook needs must be reported, not silently accepted or skipped.
