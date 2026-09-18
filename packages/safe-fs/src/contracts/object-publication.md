# Immutable object descriptors

`withObjectFileDescriptors` is exported by `@poe-platform/safe-fs` and its
portable `/core` entry. It wraps an existing canonical filesystem and an
explicit `ObjectFilePublicationStore`. It does not discover credentials,
download the workspace, create staging directories, or infer atomicity from flags.

## Host primitives

- `acquire(path, { access, signal })` authorizes access and returns an immutable
  version, or `undefined` for a missing final entry. Other errors propagate.
  Its `stat` and opaque `revision` describe the same namespace binding as its
  bytes. `read(position, maxBytes, options)` returns exactly the requested
  in-range bytes; the adapter bounds every request. `close()` releases its lease.
- Optional `publish(path, expectedRevision, source, { size, mode, signal })`
  consumes the complete byte source with backpressure, then atomically creates
  an absent entry (`expectedRevision === null`) or replaces precisely the
  expected binding. It enforces authorization and backend quotas, rejects
  conflicts with `EAGAIN`/`EEXIST`, and returns a pinned acknowledged version.
  Every publication changes the revision. A content hash without an ABA-safe
  namespace generation is insufficient.
- Optional `createStaging(path, { chunkBytes, maxFileBytes, signal })` allocates a
  private, empty page store for one descriptor. Supplying it enables bounded
  spill-backed writes; it does not replace `publish` or authorize namespace work.

These are authoritative operations, not a GET/check/PUT composition. Acquisition
pins coherent bytes during replacement. Publication cannot acknowledge before
consuming its complete source. It honors cancellation before mutation admission
and settles admitted asynchronous work. The adapter drains its owned source and
retires late receipts. Cancellation cannot roll back a committed remote operation.
The store is borrowed; the adapter owns individual acquired version leases.

The namespace and store must enforce the same path, symlink, tenant and permission
policy. A restricted namespace around an unrestricted store does not restrict that
store. Apply mount/scoped/readonly/quota wrappers to the completed adapter and
retain backend authorization for publication.

The quota wrapper reserves private conditional growth across writers and normal
namespace mutations until publication/retirement. Its existing complete-stat-
identity requirement still applies to writers; identityless stores must enforce
their own authoritative publication quotas rather than inventing inode metadata.

## Private spill storage

`ObjectFileStaging` exposes these asynchronous backend operations:

| Method | Required semantics |
| --- | --- |
| `readPage(index, { signal })` | Return `undefined` for an absent page, otherwise an exclusively owned `Uint8Array` of exactly `chunkBytes`. Caller mutation must not alter stored pages or another read result. |
| `writePage(index, bytes, { signal })` | Replace one complete page. Consume/copy the borrowed bytes before resolving; do not mutate them or retain a mutable alias. |
| `truncate(size, { signal })` | Delete pages whose start is at or beyond `size` and zero the removed tail of a retained partial page. Growth must not restore removed bytes. |
| `close()` | Idempotently discard all private pages and release resources, awaiting admitted work and cleanup even after cancellation. |

Page indexes are zero-based, not byte offsets. The final page may be padded past
`maxFileBytes`; only the descriptor's logical size is published. All operations
must enforce the same tenant/authorization scope as acquisition. Separate calls
to `createStaging`, even for the same path, must never share mutable pages. Its
creation signal applies to acquisition only; successful handles use each later
operation's signal. Pre-aborted operations must reject before mutation. Backend
errors and cancellation identities propagate unchanged.

Use externally backed pages with bounded transfers, not a full-file buffer or a
Worker-resident map. The backend owns page metadata, storage quotas, provider
request limits, operation deadlines and crash/orphan reclamation. The adapter keeps no in-memory index of
spilled pages and requires neither host disk nor workspace copies. An R2/object
store or another explicitly provided backend can implement this primitive;
neither a Cloudflare binding nor provider credentials are discovered implicitly.
This is an integration contract, not a bundled R2/S3 staging implementation.

With staging supplied, each write is processed one page at a time, even if the
call exceeds the memory budget. Active page buffers share `maxStagedBytes` and
`maxStagedPages` across descriptors; pressure waits with cancellation rather than
retaining all dirty pages. At least one page must fit. Reads of spilled pages
participate in the same admission. Caller-owned buffers, bounded publication and
immutable-range buffers, and backend transport/cache allocations remain separate
and require their own limits.

Sequential page-aligned output spills each page once and reads it once for one
streaming publication at close; it never repeatedly uploads the growing file.
Partial-page writes use bounded read/modify/write of that page, so small writes
can amplify I/O by the fixed page size, not by the growing file size. Explicit
`sync` or synchronized-open modes still publish complete generations and can be
expensive when requested after every small write. There is no automatic sync to
evade the staging limit.

## Observable semantics

`capabilities.versionedDescriptors` and each handle's
`capabilities.publication === "conditional"` identify this non-POSIX profile.
Descriptor access masking, serialization and per-operation cancellation apply.
The acquisition signal stops governing the handle after open succeeds.

Readers pin immutable versions. Writer updates are private until `sync` or `close`;
existing readers do not observe them, including after publication. Open-creation
and open-truncation publish an empty generation before returning. Append targets
the descriptor's private end, not a globally serialized shared append position.
Truncation followed by growth zero-fills the removed tail. Positioned writes do
not advance the cursor. Flush acquires the new version and releases dirty pages
and any private staging handle; a later write acquires fresh empty staging.
Rename/unlink/replacement cannot redirect a reader, but a writer's later flush can
conflict with its original pathname's changed binding.

Publication failure poisons the writer: subsequent operations/close preserve its
reason and never retry a possibly committed update. Close releases leases and
budgets even when flush or retirement fails. A storage sync is an acknowledged
conditional publication, not a provider-independent physical durability guarantee.
Host close operations must eventually settle cooperatively.

An admitted spill write or spill truncation failure also poisons the writer:
close discards its unpublished staged bytes instead of committing an unknown
partial mutation. The last published generation survives, including the empty
generation from an earlier creating/truncating open. A failed/cancelled
publication may already have committed remotely; it is never retried. Failure to
retire staging after successful publication reports failure but cannot undo that
publication. Cleanup still attempts both old and current version retirement.
Nonmutating admission failures (for example a pre-aborted write or `EFBIG`) do
not revoke earlier accepted writes; ordinary close may still publish those bytes.

Python `file.flush()` drains Python's userspace buffer into the descriptor; it
does not issue a filesystem sync. With `createStaging`, ordinary binary writes
larger than the memory budget need no manual flush/sync to free pages. Without
staging, `os.fsync(file.fileno())` after flushing publishes incrementally and
releases dirty pages, but frequent whole-object publication is not a scalable
substitute for spill storage.

Descriptor stat reports private logical size/mtime but does not invent allocation
metadata. Namespace stats describe the published generation. No mutable inode or
POSIX unlink visibility guarantees are added.

## Configuration

All limits are positive safe integers, shared by handles from one adapter:

| Option | Default | Meaning |
| --- | --- | --- |
| `chunkBytes` | 65,536 | Range/publication chunk and dirty-page size; maximum 1,048,576 |
| `maxStagedBytes` | 8,388,608 | Aggregate dirty-page payload without spill; active page workspace with spill |
| `maxStagedPages` | 4,096 | Aggregate dirty-page metadata without spill; active page count with spill |
| `maxFileBytes` | 268,435,456 | Maximum logical acquired/generated file size |
| `maxOpenFiles` | 64 | Handles, including acquisitions/retirements in progress |

No environment variables are read. Without `createStaging`, exhaustion still
rejects `ENOSPC`; adding descriptors alone does not make large writes fit an
in-memory staging budget. Configure an actual spill backend rather than raising
that budget to the full file limit. With spill, a budget smaller than one page
rejects `ENOSPC`, and backend storage errors still propagate. File-size exhaustion
rejects `EFBIG`; descriptor admission rejects `EMFILE`. Host caches and upload
transports need their own bounds.

## Python and unsupported operations

Supply the resulting filesystem to `PythonFileSystem` or a Shell using the Python
command plugin. Native descriptor I/O, pathlib, local scripts and imports work
without replacing Python builtins or creating a workspace mirror.
Without `publish`, only noncreating read opens work; mutation rejects `ENOTSUP`
with an authoritative-publication diagnostic. Readonly policy rejects `EROFS`
before acquisition. Invalid receipts/short immutable reads reject `EIO`.

Directory operations remain those of the canonical namespace. Python unlink
requires a final-entry removal primitive that atomically refuses directories;
generic `rm` is not presumed to have that guarantee. Supply `unlink` when the
backend can enforce it, rather than using a race-prone stat/remove approximation.
Temporary-directory cleanup additionally requires descriptor-safe directory APIs
or authoritative `removeTreeConditional`. Neither this adapter nor capability
booleans create those backend guarantees.

## Shared qualification

Import `createObjectFilePublicationConformanceCases` from
`@poe-platform/safe-fs/testing/object-publication`. Supply `createFixture()` returning
`{ fs, store, root, dispose }` with an isolated namespace and authoritative store.
Run every returned `{ name, run }`. Cases cover pinned bytes, conditional updates,
exclusive-create races, pre-cancelled publication and descriptor flush. Missing
publication fails qualification rather than counting as a skipped success.

Set `requireStaging: true` to additionally require `createStaging` and run the
private-page ownership/isolation, truncation, cancellation and over-budget
descriptor-write cases. Missing spill support then fails qualification; it is
not counted as a supported large-write path. These backend cases and the
maintained Python bridge write test are not interpreter qualification. Actual
ordinary Python execution remains a separate executor/provider acceptance gate
(including Cloudflare deployment and local Miniflare); enabling staging alone
does not establish it.

The maintained standalone Pyodide acceptance is
`packages/safe-bash/tests/integration/pyodide-runtime/public-object-publication.test.mjs`.
It exercises installed packages on immediate/delayed immutable versions using
Memory's authoritative conditional-write primitive, including a 16 MiB binary and
bounded flushed output. This qualifies that integration model, not an untested
Poe, S3, WebDAV or Cloudflare deployment.
