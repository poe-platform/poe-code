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

The source-level native staging regression is
`packages/safe-fs/tests/integration/object-staging-native.test.mjs`. It bundles
the existing Node `createNodePythonWorker` executor and the candidate SafeFS
source with one canonical core identity. Install the pinned `pyodide@314.0.6`
runtime separately, then run from the repository root:

```sh
SAFE_FS_PYODIDE_ROOT=/absolute/path/to/node_modules/pyodide \
TMPDIR="$PWD/out/native-staging" \
node --test packages/safe-fs/tests/integration/object-staging-native.test.mjs
```

Create the output directory first. The checkout needs its `esbuild` and
`@noble/hashes` build dependencies; no Python executor source edits or workspace
mirror are involved. This is an opt-in integration test, not a unit-suite task.
It runs actual Python `open`/binary `write`/context-manager close, followed by
native chunked readback and SHA-256, for 9 MiB and 100 MiB on immediate and delayed
callbacks. It does not call `flush` or `fsync`, or replace Python builtins.
`maxFileBytes` equals the tested size; staging remains one 64 KiB page.
The independent Shell `maxOutputBytes` limit is explicitly set to the tested
size plus 64 KiB, and `maxWallClockMs`/`maxCpuMs` to 75 seconds for the delayed
100 MiB integration, rather than disabling these limits. Setting
`SAFE_FS_STAGING_DISABLED=1` removes the fixture's optional primitive and makes
the same success assertions fail with native `ENOSPC`.

This fixture stores private pages and streamed immutable generations on local
disk, with a process-local namespace. It checks the output hash, exactly one
spill write/read/publication pass, unpublished intermediate pages, two
publications (empty creating open and final close), and resource retirement.
It is neither an authoritative consumer adapter nor a permission/concurrency
qualification for that consumer. It measures adapter page admission and I/O
counters, not process RSS, interpreter memory, host cache bounds or a 128 MiB
Worker memory envelope. Node's trusted interpreter is not host isolation and
does not qualify the Cloudflare executor, local workerd integration or deployed
Cloudflare acceptance. Those still require the qualified executor and the
actual consumer's `createStaging` implementation plus its authoritative
publication adapter; existing stores without that primitive remain limited.

The separate native workerd staging regression is
`packages/safe-fs/tests/integration/object-staging-workerd.test.mjs`. It runs the
same 9 MiB/100 MiB immediate/delayed native workload through the static JSPI
executor in local Miniflare, with real R2 private pages and streamed R2 immutable
versions. Its namespace and compare-and-swap are process-local fixtures, not a
production authoritative store. It checks native readback hashes, linear
spill/read/publication byte counts, intermediate visibility and R2 cleanup.

This cross-layer test requires a checkout containing the qualified JSPI/native
syscall source layout, a specified immutable executor commit, the pinned Pyodide
assets, Miniflare `5.20260917.0-alpha` and workerd `1.20260917.1`. For example:

```sh
SAFE_FS_EXECUTOR_ROOT=/absolute/path/to/executor-checkout \
SAFE_FS_EXECUTOR_REVISION=<qualified-executor-commit> \
SAFE_FS_STAGING_REVISION=<candidate-staging-commit> \
SAFE_FS_PYODIDE_ROOT=/absolute/path/to/node_modules/pyodide \
SAFE_FS_WORKERD_ROOT=/absolute/path/to/installed-miniflare-project \
TMPDIR="$PWD/out/workerd-staging" \
node --test packages/safe-fs/tests/integration/object-staging-workerd.test.mjs
```

Create the output directory first and supply a workerd executable compatible
with the host, using `MINIFLARE_WORKERD_PATH` if necessary. The test reads
executor/SafeFS module contents from the frozen Git commit; only the
object-publication module is replaced by the selected candidate, preserving a
single canonical core identity. Package resolution metadata must match the
frozen revision. Omitting `SAFE_FS_STAGING_REVISION` uses the current checkout's
object-publication source instead. Diagnostics identify the executor commit,
candidate digest and selected staging commit. Assets are hash-checked and Wasm
modules are precompiled; no executor source is edited and no workspace data is
copied. `SAFE_FS_STAGING_DISABLED=1` provides the failing no-spill native control.
Set `SAFE_FS_EXPORT_WORKER_DIR` to a new directory under checkout `out/` to export
the exact tested modules and their hash manifest, only after all four cases pass.
The fixture requires an expiring bearer secret, empty POST requests, fixed sizes
and profiles, and rejects overlapping work in the same isolate. That guard is
not a global deployment concurrency limit. Owner-run deployment, bounded request
instructions and teardown are in
`docs/plans/issue763-cloudflare-staging-qualification.md`.

Passing this route qualifies the exercised local static-JSPI/R2 fixture only.
It is not an installed-package staging test, a managed Python Worker native
mount, a production host adapter or a deployed Cloudflare result. Initial Wasm
memory capacity in diagnostics is not peak interpreter/Worker memory. The
consumer still needs an owned `createStaging` implementation, authoritative
authorization/publication, bounded caches and provider request/memory quotas,
orphan reclamation, and deployment access. Run the public backend conformance
and shared-pressure/failure/cancellation matrix on that actual host as well as
the native workload; success on fresh fixture output does not replace those
requirements.

### Installed public-package staging mode

The same workerd test accepts `SAFE_FS_PUBLIC_CONSUMER_ROOT` plus
`SAFE_FS_PUBLIC_ADMISSION` instead of an executor checkout. The consumer must be
an independent npm installation under this checkout's `out/`, with matching
`@poe-platform/safe-bash`, `safe-fs` and `safe-js` versions. It resolves Shell
from the public package and Python/assets/generators from
`@poe-platform/safe-bash/commands/python`, with the canonical filesystem from
`@poe-platform/safe-fs/core`, using workerd/browser export conditions.

Public mode rejects all executor/staging source selection variables. It never
reads Git or overlays product source. Build-input admission rejects workspace
product files, nested/unmatched public package copies and unpinned public bytes;
only the test's own Worker/R2 fixture and pinned Pyodide assets may sit outside
the independent installation. Missing exports or metadata fail rather than
falling back to a checkout. The frozen mode and its metadata/asset checks remain
available separately.

The admission JSON has `schemaVersion: 1`, an exact `version`, `lockSha256`,
`origin` (`locally-packed-candidates` or `registry-release`), and a `packages`
object keyed by the three full public package names. Each entry supplies
`resolved` and SHA-512 SRI `integrity` matching its npm lock receipt, `tarball`
(path relative to the consumer), and `files` (every archive file's package-relative
path mapped to SHA-256, including `package.json`). Generate file hashes from
the reviewed archives, not the potentially modified installed files. Admission
checks archive bytes, installed bytes/metadata, the installation lock, exact
SafeFS dependency pairing, and absence of package/file symlinks. Preserve the
reviewed manifest: these are caller-supplied provenance pins and npm receipts,
not a claim of signed build attestation.

Candidate mode requires local archive receipts. Registry mode requires matching
HTTPS npm-registry receipts and reviewed copies of those same registry tarballs.
A locally packed candidate is never relabeled as a published release merely
because its version matches. Exported qualification manifests and diagnostics
record mode, origin, versions, integrity receipts, admission/lock hashes and
the installed module-input digest, rather than inventing a source commit.
The 9/100 MiB immediate/delayed R2 matrix and all limits remain unchanged. This
mode does not establish deployment or production-host acceptance.
