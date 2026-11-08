# Constructor comparison for SDK-backed storage

`S3FileSystemOptions.compareEntry` is an optional application-supplied callback
using the existing `FileSystem.compareEntry` arguments and return type. Its local
derived signature adds `this: FileSystem`; no shared contract or root export is
added. The isolated public consumer proves assignability in both directions.

```ts
import { S3FileSystem, type FileSystem, type S3FileSystemOptions } from "virtual-bash";

const comparison: NonNullable<S3FileSystemOptions["compareEntry"]> =
  async function (path, peer, peerPath, options = {}) {
    options.signal?.throwIfAborted();
    const own = await applicationBackingResolver(this, path, options);
    options.signal?.throwIfAborted();
    const other = await applicationBackingResolver(peer, peerPath, options);
    options.signal?.throwIfAborted();
    if (!own || !other) return "unknown";
    return applicationEntryComparison(own, other);
  };

const filesystem = new S3FileSystem({
  transport: sdkTransport,
  bucket: "objects",
  compareEntry: comparison,
});
```

The resolver/comparator and SDK transport in that sketch are supplied by the
application, not library exports. A runnable, typed, self-contained implementation
is `tests/fs/s3/constructor-comparison/consumer.mts`. It imports only the public
`virtual-bash` package and Node test/assert modules. Its application owns the actual
Memory backing behind a serialized SDK-like transport and resolves real backing
stat identities; it does not use private Mock Maps, private authority helpers,
ETags or client objects as identity. ETag versions in its bounded provider model
serve only write/delete conditions, never entry comparison.

## Receiver and composition

The constructor snapshots the callback privately. It does not replace the public
`filesystem.compareEntry` negotiation method. The callback receives the actual
resolved backend as `this`, its followed backend-local `path`, the resolved peer
backend and peer-local path, and the same `options.signal`. Regular functions can
use the typed receiver; an arrow function must instead close over a truthful
application mapping. Do not expect `this` to be the options object, transport,
mount wrapper or arbitrary originally supplied peer wrapper.

1. Complete scoped identities retain the existing helper precedence, with no
   authority callback query. Metadata errors/cancellation still propagate.
2. For incomplete identities, each distinct enrolled S3 operand selects its late
   explicit public-method override if present; otherwise its constructor callback.
   A late override replaces, rather than adds to, the configured callback. Removing
   the public method leaves explicit unknown, not the configured fallback.
3. Selected callbacks run once per operand. The same function on two different
   operands runs with each receiver; one filesystem occupying both operands is
   queried once. Reentrant negotiation stays unknown. Callbacks must resolve actual
   application/provider backing metadata, not recursively negotiate these views.
4. Invalid answers and contradictory selected callback answers fail EIO before
   effects. Real callback errors and abort reasons propagate. Cancellation is
   checked after callbacks and before the next operand; uncooperative host code
   cannot be forcibly terminated by this API.
5. Fresh built-in **same** evidence is retained even when a callback is selected:
   callback same/unknown leaves same; callback distinct conflicts and fails EIO.
   There is no early same return that hides an explicit callback's EACCES, invalid
   result or cancellation. This supersedes the initial early-return proposal.
6. When a custom callback is selected and there is no built-in same proof, use the
   explicit result. Explicit unknown does not revive built-in distinctness. A
   built-in distinct result is an unselected fallback in this case, preserving
   existing explicit-override composition. With no selected custom callback, the
   normal built-in same/distinct/unknown behavior remains.

These are S3 terminal-authority rules. Shared negotiation may also obtain an
independent answer from another backend; cross-authority conflicts still fail EIO.
An S3 unknown answer is not a veto of a different operand's actual authority.

Readonly, creation exclusivity, source/target type checks and copy/move permission
errors remain independent protections. The callback is not write authorization.
Native S3 copy/rename preconditions and nonatomic/partial-effect limitations are
unchanged. The callback does not make an unknown final symlink safe to unlink.

## Host responsibilities and limits

Return same/distinct only for the actual backing entries used by content operations.
Overlapping prefixes, clients, mounts and protocols can represent one entry. A
resolver must return unknown for an unrecognized mapping; different endpoints,
client references, credentials, bucket labels, ETags or content hashes are not
proof of disjointness. Serialized HEAD metadata does not acquire Mock provenance.
The application must obtain truthful backing authority through its provider or
own resource mapping. A cache/remapper must omit or replace incorrect assertions.

Queries must be metadata-only, forward cancellation, and propagate missing,
authorization and I/O errors. Do not read object bodies, open destinations, mutate,
lock or delete during comparison. Results are observations, not leases, transactions,
ABA defenses, provider authentication or snapshot/pathname-race guarantees.

The consumer is a bounded SDK-shaped model, not an installed AWS/MinIO SDK, a live
service test or a general-purpose gateway. Arbitrary providers without a truthful
resolver still have unknown existing-target relationships. There is no global
trust flag, fabricated namespace or automatic real-provider identity discovery.
