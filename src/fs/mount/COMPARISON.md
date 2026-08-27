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

Memory already publishes per-store complete identity; real publishes actual safe
native IDs in the agreed global native scope. They need no new authority token
or fallback method. Remote callbacks must use native/provider-owned or mutually
recognized authority. Distinct clients, protocols, URLs, keys, ETags and tokens
alone are not disjointness proof; a custom remote transport can access local
storage. Provider-specific metadata maps may support recognition but must not
duplicate the wrapper-view registry or relabel backing entries.

Resolution and callbacks are metadata-only: no source body, destructive open,
copy-up, cleanup, lock-null resource or publication. Overlay resolution describes
its selected read view; copy guards inspect the actual destination independently
inside its mutation queue. The immutable-lower/exclusively-owned-upper
prerequisites still apply. Readonly results do not grant write permission.

This is point-in-time evidence, not a lease, ABA defense, provider authentication,
conditional deletion or pathname-race guarantee. Default opaque-client fixtures
without usable provider authority cannot be made distinct by guessing; their
remaining proof-hook needs must be reported, not silently accepted or skipped.
