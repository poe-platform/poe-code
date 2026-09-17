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
not advance the cursor. Flush acquires the new version and releases dirty pages.
Rename/unlink/replacement cannot redirect a reader, but a writer's later flush can
conflict with its original pathname's changed binding.

Publication failure poisons the writer: subsequent operations/close preserve its
reason and never retry a possibly committed update. Close releases leases and
budgets even when flush or retirement fails. A storage sync is an acknowledged
conditional publication, not a provider-independent physical durability guarantee.
Host close operations must eventually settle cooperatively.

Python `file.flush()` drains Python's userspace buffer into the descriptor; it
does not issue a filesystem sync. Use `os.fsync(file.fileno())` after flushing to
publish incrementally and release staged pages before close.

Descriptor stat reports private logical size/mtime but does not invent allocation
metadata. Namespace stats describe the published generation. No mutable inode or
POSIX unlink visibility guarantees are added.

## Configuration

All limits are positive safe integers, shared by handles from one adapter:

| Option | Default | Meaning |
| --- | --- | --- |
| `chunkBytes` | 65,536 | Range/publication chunk and dirty-page size; maximum 1,048,576 |
| `maxStagedBytes` | 8,388,608 | Aggregate dirty-page payload; reserved before reads |
| `maxStagedPages` | 4,096 | Aggregate dirty-page metadata admission |
| `maxFileBytes` | 268,435,456 | Maximum logical acquired/generated file size |
| `maxOpenFiles` | 64 | Handles, including acquisitions/retirements in progress |

No environment variables are read. Staging exhaustion rejects `ENOSPC`; flush
before further writes or explicitly increase limits. File-size exhaustion rejects
`EFBIG`; descriptor admission rejects `EMFILE`. Only dirty pages are buffered, not
the entire unchanged object. Host caches and upload transports need their own bounds.

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

The maintained standalone Pyodide acceptance is
`packages/safe-bash/tests/integration/pyodide-runtime/public-object-publication.test.mjs`.
It exercises installed packages on immediate/delayed immutable versions using
Memory's authoritative conditional-write primitive, including a 16 MiB binary and
bounded flushed output. This qualifies that integration model, not an untested
Poe, S3, WebDAV or Cloudflare deployment.
