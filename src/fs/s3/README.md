# S3-compatible filesystem

`S3FileSystem` implements the shared `FileSystem` contract using an injected
S3-shaped transport. It is not a memory filesystem with an S3 name. Reads,
writes, listings, copies, and deletions call that transport. `MockS3Client` is a
separate, network-free implementation of the same six-operation interface.

This module creates no network clients, reads no environment credentials, and
performs no requests during construction. It has no runtime package dependencies
beyond Node built-ins and the local contracts. An injected transport may access a
remote service: the caller owns its endpoint, explicit credentials, signing,
network authorization, retries, and lifecycle. Do not inject a client with an
ambient credential-provider chain if ambient access is prohibited.

## Local use

Import from this directory's `index.ts` or the source root `src/index.ts`.
The root exports and the manifest's `virtual-bash/fs/s3` subpath are already wired.
Source-root imports are exercised by the backend production-flow tests and the
shared tool matrix. This source-owner revision does not edit package/export files
or claim a new built-package validation; building `dist/` remains a root task.

```ts
import { MockS3Client, S3FileSystem } from "./src/fs/s3/index.js";

const transport = new MockS3Client({ buckets: ["workspace"], pageSize: 2 });
const fs = new S3FileSystem({
  transport,
  bucket: "workspace",
  prefix: "agent/session-1",
});

await fs.mkdir("/work", { recursive: true });
await fs.writeFile("/work/data.bin", new Uint8Array([0, 255, 128]));
const data = await fs.readFile("/work/data.bin");
```

The bucket must already exist. A canonical relative `prefix`, optionally ending
in `/`, isolates virtual `/` from neighboring object prefixes. Above-root `..`
is rejected with `EACCES`, not clamped. Other dot components and duplicate virtual
slashes normalize lexically; symlink resolution does not occur. Percent sequences
and backslashes are literal key characters. NULs and unpaired Unicode surrogates
are invalid. The 1024-byte UTF-8 object-key limit includes the configured prefix.
Bucket URLs, slash-containing access-point ARNs, and cross-bucket filesystem paths
are not accepted.

## Production transport contract

`S3Client` is the promise-based, AWS-S3-shaped subset in `transport.ts`.
`createS3Transport(client, capabilities)` binds its methods and explicitly declares
optional service features. It never constructs an SDK client or installs an SDK.
A caller can wrap an already authorized SDK client or implement the protocol
directly. SDK v2 request objects must be converted with `.promise()`; command-based
SDK clients must map these methods to their corresponding commands. Aggregated
promise-based clients can supply the six methods directly when structurally
compatible. No live cloud or installed AWS SDK compatibility test has been run.

| Method | Inputs used | Outputs consumed |
| --- | --- | --- |
| `headObject` | `Bucket`, `Key` | `ContentLength`, `LastModified`, `ETag`, `Metadata` |
| `getObject` | `Bucket`, `Key` | binary `Body`, `ContentLength`, `ETag`, `Metadata` |
| `putObject` | `Bucket`, `Key`, `Body`, optional `Metadata`, `IfMatch`, `IfNoneMatch` | fulfilled promise |
| `listObjectsV2` | `Bucket`, `Prefix`, `MaxKeys`, optional `/` `Delimiter`, `ContinuationToken` | `Contents`, `CommonPrefixes`, `IsTruncated`, `NextContinuationToken` |
| `copyObject` | `Bucket`, `Key`, URL-encoded `CopySource`, `CopySourceIfMatch`, `MetadataDirective: "COPY"` or `"REPLACE"`, optional `Metadata`, destination `IfMatch`/`IfNoneMatch` | `CopyObjectResult.ETag` |
| `deleteObject` | `Bucket`, `Key`, optional `IfMatch` | fulfilled promise |
| optional `getObjectStream` | `Bucket`, `Key`, `IfMatch`, optional `Range` | async binary `Body`, `ContentLength`, `ETag` |
| optional `putObjectStream` | `Bucket`, `Key`, async binary `Body`, optional `Metadata`, `IfMatch`, `IfNoneMatch` | fulfilled promise after consuming and publishing the body |

Each method accepts an optional second argument `{ abortSignal }`. Reject service
failures using AWS-style `name`/`code`/`Code` and/or
`$metadata.httpStatusCode`. A protocol implementation must parse the complete copy
response and reject embedded errors, including errors inside HTTP 200 responses;
HTTP status alone is not a completed copy. The adapter also rejects missing copy
confirmation before starting any source deletion. Listing keys must be decoded
exactly once by the transport, with sizes and prefixes preserved. The adapter does
not parse XML or perform signing itself.

`Body` may be a `Uint8Array` (including Buffer), an async iterable of binary chunks,
or an SDK-style object exposing `transformToByteArray()`. Text bodies and text
chunks are not accepted. Async iterable bodies are collected with a byte limit;
byte-array transforms necessarily allocate inside the transport before the result
can be checked. On read failure the adapter also invokes an available `destroy()`
or `cancel()` body hook. Transport implementations must release other response
resources on failure and obey cancellation. No local filesystem access is used.

Only declare `conditionalPut`, `conditionalCopy`, or `conditionalDelete` when the
selected service and client actually support and enforce the corresponding
preconditions. `createS3Transport` defaults all three to absent. The mock declares
all three. `conditionalCopy` now covers destination `IfMatch` as well as
`IfNoneMatch`; source `CopySourceIfMatch` is required for every copy. A service
that silently ignores preconditions is not compatible with
these enabled features.

Production-flow update, August 26, 2026: streaming is separately negotiated by
`streamingRead`/`streamingWrite` and optional `getObjectStream`/`putObjectStream`
transport methods. The read method returns an async binary body and enforces
`IfMatch` and optional inclusive HTTP `Range`; the write method consumes an async
binary body with backpressure and resolves only after completed publication.
Unknown-length request encoding, signing, provider buffering and any multipart
lifecycle belong to the transport. Do not enable these capabilities on a wrapper
that first materializes an entire remote object/request. The mock streams chunks
from its in-memory object store and stages uploads in memory before publication;
it is not a model of bounded-memory cloud storage.

`getObjectStream` and `putObjectStream` are adapter transport hooks, not literal
AWS SDK method names. Wrap an authorized client's streaming GetObject response
without collecting it, and map the streaming upload to an implementation that
supports an unknown input length. Ordinary single-PUT SDK compatibility cannot be
inferred from accepting a Node stream: signing and length/checksum requirements
must be met by that integration. `createS3Transport` forwards these optional
hooks with their client binding intact. Its capability defaults stay disabled.

Without these negotiated methods, filesystem stream methods are absent, not
throwing stubs. `readFile` remains an explicitly bounded buffered fallback for
consumers that permit one; named gzip requires genuine streams and still rejects
buffer-only transports. `maxStreamBytes` defaults to 5,000,000,000 and limits total
transfer bytes, not heap allocation. Output chunks are copied and split to
`chunkSize` (64 KiB default); provider input chunk allocations are outside that
bound. Stream reads use an ETag-pinned snapshot/range and validate lengths.
Streaming replacement/exclusive writes use the streaming transport. Append is a
bounded read/modify/write fallback, constrained by `maxReadBytes`, not streaming
append. Neither interface promises a hard whole-process memory bound.

Early read closure cancels the operation signal and closes the response iterator;
stalled reads, writes and transport calls stop waiting on caller cancellation.
Late promise rejections are observed and late response bodies are released.
Upload failures close the producer, including a pending pull. A transport that
claims success without consuming the whole input is rejected with `EIO`, but
there is no rollback for a dishonest transport's already-performed side effects.
Cancellation cannot undo remote publication or forcibly stop an uncooperative
transport; the transport must honor its supplied signal and body cleanup hooks.

## Filesystem behavior and limits

- Additive `rmdir(path, options?)` is directory-only: observed files fail with
  `ENOTDIR`, missing paths with `ENOENT`, and observed descendants (including
  child directory markers) with `ENOTEMPTY`. With `capabilities.snapshotRmdir: true`,
  a fully observed-empty explicit zero-byte marker is removed by one exact-key
  DELETE. The marker must be identified by HEAD and seen in the completed LIST;
  an implicit directory without explicit marker is unsupported, and a marker
  that disappears from inspection yields `ENOENT`. The mounted root is `EBUSY`;
  read-only mode and cancellation retain `EROFS` and `ECANCELED` respectively.
  Inspection failures propagate as typed errors with the requested rmdir path
  and the underlying error retained as their cause.
- This is the explicit snapshot-marker profile, not atomic empty-prefix deletion.
  Children created after inspection survive and may keep the directory visible
  after success. No descendant is deleted, hidden or rolled back; no marker is
  reinserted, and no post-delete `ENOTEMPTY` is reported. Marker deletion is
  unconditional even if object conditions exist: a concurrent replacement at
  that exact key can be removed, including same-content ABA. Errors or abort
  after issuing DELETE may leave effects; cancellation cannot undo host work.
  `conditionalDelete` is not enabled by this profile and cannot guard prefix
  emptiness. Existing `rm` semantics and `atomicRename: false` are unchanged.
  Removal LIST requests use `MaxKeys = Math.max(2, pageSize)` and delimiter `/`,
  follow continuation tokens to completion, require explicit `IsTruncated`, and
  retain `maxListEntries` bounds. Other operations retain their page policy.
  The minimum of two avoids the pinned MinIO exact-prefix one-key optimization;
  it is not endpoint-name inference or proof of arbitrary provider correctness.
  Truthful complete prefix listing and exact-key DELETE are host prerequisites;
  HTTP200 alone is not completeness evidence. Invalid/incomplete inspection
  fails before mutation. No constructor option or runtime dependency is added.
  The pinned provider proof and original 19/20 remain in
  `tests/fs/s3/rmdir-real-service/list-oracle-review/REPORT.md`; new behavior
  requires its own service evidence and does not rebaseline old results.
  Protocol references: AWS S3 `DeleteObject` request conditions and the S3
  user guide's folder/prefix model, consulted August 26, 2026:
  `https://docs.aws.amazon.com/AmazonS3/latest/API/API_DeleteObject.html` and
  `https://docs.aws.amazon.com/AmazonS3/latest/userguide/using-folders.html`.
- Empty directories use zero-byte keys ending in `/`. Prefixes with descendants
  are also directories without requiring a marker. Implicit directories disappear
  when their final descendant is removed; explicit markers persist until removed.
- Files and directory prefixes with the same virtual path are ambiguous. They,
  nonempty slash-suffixed objects, and noncanonical remote keys fail with `ENOTSUP`
  when encountered, rather than being hidden or destructively projected.
- Every listing follows opaque continuation tokens. Missing/repeated tokens,
  escaped response keys, malformed sizes, and invalid direct children fail closed.
  `readdir` sorts names by UTF-8 byte order and excludes the directory's own marker.
- Default `pageSize` is 1000 (range 1–1000). `maxListEntries` defaults to 100,000.
  Recursive deletion and directory rename collect and validate the complete key
  list before mutation, subject to this bound. They are not transactional snapshots.
- `readFile` defaults to a 64 MiB `maxReadBytes` bound, further reduced by a call's
  `maxBytes`. It copies bytes, never decodes file contents, and validates reported
  response lengths. Ordinary writes may exceed the read bound. Single writes and
  server-side copies are conservatively limited to 5,000,000,000 bytes; multipart
  uploads/copies are not implemented.
- `writeFile` supports `w`. `wx`/`ax` require conditional put and use
  `IfNoneMatch: "*"`. Existing exclusive destinations report `EEXIST`.
  `appendFile`/`a` require conditional put and perform bounded whole-object
  read/modify/write with `IfMatch`, or `IfNoneMatch` for a new file. Concurrent
  conflicts report `EAGAIN`, without an implicit retry. User-defined `Metadata`
  is retained on append; SDK-specific system metadata, tags, ACLs, encryption,
  version history, retention, and storage policy are not a filesystem metadata
  contract and must be handled by the supplied transport. Replacing objects can
  change those service-managed properties; this adapter does not promise their
  preservation.
- `copyFile` uses server-side copy and an opaque source ETag. Exclusive copy
  requires conditional copy; an already-present destination reports `EEXIST`.
  After an exclusive-copy 412, the adapter rechecks the source ETag and then the
  exact destination key. An unchanged observed source plus an existing destination
  reports `EEXIST`, preserving the original copy failure as its cause. A changed
  or missing source, an absent destination, or failed diagnostic reads leave the
  original `EAGAIN` intact. Diagnostic cancellation reports `ECANCELED`.
  Nonexclusive copies and 409 conflicts are not reclassified. These follow-up
  reads are best-effort observations, not an atomic reconstruction of which
  precondition failed; further races or same-ETag changes remain ambiguous.
  Concurrent deletion of an ETag-guarded object may instead report `ENOENT`.
- `stat`/`lstat` return real file sizes and service modification times where
  supplied. Modes default to synthetic `0100644`/`040755`. Explicit creation modes
  are retained as advisory `virtual-bash-mode` user metadata, including private
  gzip staging modes; replacements retain an existing mode. They are **not IAM,
  ACLs, or cross-client security enforcement**. `permissions` remains false and
  `chmod` remains unsupported. Do not use a mode-0700 prefix as a security boundary
  against other authorized S3 writers. Deploy with appropriate prefix/IAM access.
  `atimeMs` defaults to zero; `ctimeMs` reflects service LastModified where known.
  Unknown directory times are zero. No inode, birth time, ownership, or link-count
  guarantee is made.
- Links and POSIX permission emulation remain unsupported.
  `utimes` stores virtual millisecond timestamps in user metadata using guarded
  metadata-replacement copy; it does not change S3's system `LastModified`.
  Conditional-PUT-only transports use a bounded read/modify/write fallback.
  Implicit directories gain a conditional marker; prefixed-root times use its
  marker, while an unprefixed bucket root has no representable object for utimes.
  Reads do not automatically update atime. The `virtual-bash-atime`,
  `virtual-bash-mtime` and `virtual-bash-mode` metadata keys are reserved; invalid
  externally supplied values fail stat with `EIO`. Content changes clear the
  virtual mtime override, retain atime/mode and preserve other user metadata.
  Metadata-only races can retain the same ETag and remain last-writer-wins.
  Added metadata must fit the provider's user-metadata budget (2 KiB on AWS).
  `truncate` uses bounded conditional writes and zero-padding. Streaming providers
  fetch only the retained prefix; truncating to zero does not download the old
  object. Buffered providers still need a bounded whole read for nonzero lengths.
  Growing beyond `maxReadBytes` is rejected before mutation.
  `realpath` is existence-checked lexical normalization. `access` checks existence,
  readonly policy, and synthetic directory traversal/file execution policy;
  successful write checks are not predictions of IAM authorization. Actual
  operation permissions remain service-enforced; root metadata requires listing.
- `readOnly` blocks mutations before IO. Abort signals are forwarded; service
  authorization failures are `EACCES`, never absence. `force` removal suppresses
  missing paths, not authorization failures or missing buckets. The mounted root
  cannot be removed or renamed.

## Namespace isolation

`exclusive: true`, `wx`, and `ax` protect **one exact object key**, not a POSIX
directory tree. They do not reserve a path, lock its parents, or prevent a
concurrent writer from creating a directory marker or descendant. For example,
another writer can create `target/child` after destination preflight and before
the conditional copy to `target`. Because `target` itself is still absent, the
copy can succeed. Both objects remain; subsequent filesystem access to `/target`
rejects the file/prefix collision with `ENOTSUP`. The conformance suite explicitly
reproduces this outcome for exclusive copy and exclusive write. The adapter does
not delete either object to pretend the race was rolled back.

Preflight checks reject conflicts that are already visible, but cannot enforce
tree-wide isolation against concurrent clients. A post-write check would not
remove that limitation or make an earlier mutation atomic. Strict namespace
isolation requires external coordination covering every writer, or a different
filesystem; this adapter provides neither a distributed lock nor a transaction.
No POSIX-exclusive namespace or tree-consistency guarantee is implied by the
filesystem-shaped API.

## Rename and concurrency

`atomicRename` is always false. `rename` defaults to guarded publication/delete
semantics. Before any host calls it requires `conditionalDelete: true` and at
least one of `conditionalCopy: true` or `conditionalPut: true`. An absent/false
destination guard never permits an unconditional copy. Missing minimum guards
produce typed `ENOTSUP` without reading, copying, uploading or deleting objects.
`conditionalDelete` must mean ETag-conditional deletion of the current object,
not HEAD followed by unconditional DELETE or deletion of a selected old version.
Explicit
`allowNonAtomicRename: false` retains fail-before-I/O policy for callers requiring
atomic moves. This is a deliberate default-policy change, not atomic rename.

Rename preflights type conflicts, empty-directory replacement, key lengths, size
limits, and source/destination ETags. It publishes every listed object with the
preflight target ETag (`IfMatch`) or `IfNoneMatch: "*"`. Only after every completed
publication does it delete sources using their original ETags. A detected
destination race is `EAGAIN`, not silent overwrite/success; a failed source
condition prevents that source deletion. There is no unconditional downgrade.

When `conditionalCopy` is available, server-side CopyObject uses both
`CopySourceIfMatch` and the destination condition and requires a confirmed copy
result. Otherwise `conditionalPut` enables a real GET/conditional-PUT fallback:

- If both negotiated streaming hooks are available, GET uses the source ETag
  precondition and its async body passes into conditional streaming PUT with
  backpressure, copied chunks and exact length/ETag validation. `conditionalPut`
  must also be enforced by the declared streaming PUT hook. The adapter does not
  collect the object before uploading. `maxStreamBytes` is a total-transfer
  limit, not a process-memory guarantee or a bound on provider-allocated chunks.
- Other transports use `getObject` and a bounded byte collection followed by
  `putObject`. The returned response ETag must match the enumeration before PUT,
  and the actual body length must match. This path is bounded by `maxReadBytes`;
  it is not advertised as streaming. A byte-array transform or provider response
  can allocate before the adapter checks it, as documented for `readFile`.
- All source object sizes are preflighted against the selected fallback limit
  before the first destination effect, including later directory children.
  User metadata is copied from the GET response. Service metadata, encryption,
  tags, retention and versions remain transport-owned limitations.
- Cancellation is forwarded into GET/PUT and interrupts stalled source reads.
  Failure or cancellation releases the response and upload iterator, observes
  late rejections and never starts source deletion. An acknowledged PUT must
  consume its complete body; premature success is `EIO`. The existing `copy`
  error phase and `copiedKeys` mean acknowledged destination publications for
  both server-side copies and conditional PUTs; they do not imply CopyObject ran.

This is **not atomic**, not crash-safe, and not an atomic directory snapshot:
other clients can see both names, race with directory checks, overwrite targets,
or add new source keys after enumeration. ETags are opaque content validators,
not version IDs; same-content/metadata-only races can escape ETag checks. External
writers can also create file/prefix collisions between checks and writes. Ordinary
write and removal operations retain their normal overwrite/delete semantics.
Using `mkdir` without conditional put adds a check-then-write marker race.

Success has deliberately limited semantics: all enumerated source keys were
published and their ETag-guarded deletions acknowledged. It is **not** a statement
that an object incarnation was locked, all metadata changes were preserved, or
the source directory no longer exists. The following limitations are reproduced
independently for guarded CopyObject, buffered PUT and streaming PUT:

1. **Same-content ABA:** delete/recreate the source with identical bytes and new
   metadata immediately before guarded deletion. Its ETag can remain identical,
   so deletion succeeds, the recreated source disappears, and the target retains
   the earlier metadata. This generation/metadata-loss race remains unresolved;
   it is not counted as a stronger safety acceptance claim.
2. **New source child:** create a new child after enumeration. Rename resolves
   after moving the enumerated keys, but the new child survives under the source
   directory and is not copied or deleted. Success is not a directory snapshot.

Adding a final HEAD/list check cannot close the race after that check. Stronger
generation or directory guarantees require suitable provider primitives or
coordination covering every writer; this adapter implements neither. AWS
version-specific DELETE permanently removes the selected `VersionId`; it is not
an atomic condition that the current version must still be that version. Deleting
an older version can leave another version visible. Without `VersionId`, a
versioned bucket normally gains a current delete marker. The adapter does not
substitute version-specific deletion for current-object ETag-conditional delete
and does not pretend that adding a VersionId field creates a generation lock.

`S3RenameError` exposes `phase` (`copy` or `delete`), `copiedKeys`, `deletedKeys`,
and the original error as `cause`. Lists contain only acknowledged completed
operations, not requests that may have succeeded remotely before a connection
failure. Copy failure can leave destination copies; delete failure can leave a
partially removed source. No rollback is attempted because it could destroy a
concurrent writer's data. Callers must reconcile or retry with that context.
Recursive `rm` may likewise leave a partially deleted tree after failure.
Its `recursive: true` flag explicitly requests multiple deletions, not an atomic
delete or rollback guarantee. Concurrent additions can remain after enumeration;
ordinary deletion can remove a key overwritten since enumeration. Callers needing
tree-wide isolation must not rely on recursive removal or non-atomic rename without
external coordination.
Recursive `mkdir` also creates markers sequentially; if a later request fails,
already-created ancestor markers remain. None of these multi-key operations has
automatic rollback.

Only the current object view is exposed. Versioned buckets may retain historical
versions/delete markers after deletion. The mock represents unversioned,
general-purpose object storage: it does not simulate versioning, IAM evaluation,
ACLs, encryption/KMS, multipart uploads, object lock, billing, network behavior,
S3 Express directory buckets, or transactional directory operations.

## Safe cleanup workflows and historical gap

S3 now declares the snapshot-marker profile for ordinary `rmdir` and `rm -d`.
This is weaker than removal-time emptiness and absent-at-return guarantees;
callers requiring those guarantees must not substitute this operation. The unchanged
aggregate adapter-tools checkpoint `421ce3f` records 77/79, with S3 and WebDAV
historically failing the required `/work/scratch/nested` cleanup. This documentation does not
rebaseline that matrix or claim alias closure.

Supported alternatives for **different, explicitly chosen workflows** are:

- Remove a known owned file with `rm(file)` and leave its parent prefixes/markers
  in place. This does not provide empty-directory removal or cross-writer isolation.
- Keep scratch directories in a `MemoryFileSystem`, read the completed named
  result with an explicit `maxBytes` and signal, then publish those bytes with
  remote `writeFile(result, bytes, { flag: "wx", signal })`. Conditional PUT must
  be supported; an existing or raced destination stays protected. Clean the local
  scratch files and directories using local `rm`/`rmdir`. This is host-orchestrated
  VFS-only byte transfer, not cross-adapter rename, a transaction, or a guarantee
  that every command workflow transparently works across mounts. Publish/reconcile
  successfully before discarding the local result; a lost remote response can
  leave effects even when the caller sees an error.
- Only when the caller actually requests destruction of the entire subtree,
  `rm(path, { recursive: true })` removes descendants. It can leave partial effects
  and lacks a namespace snapshot. It is **never an empty-only fallback**, including
  after an empty listing or a failed `rmdir`.

The executable examples and exact preservation checks are in
`tests/stress/adapters/remote-safe-workflows.test.ts`. They use the repository
mock, not live IAM/provider validation. Modes remain advisory metadata, not an
authorization boundary. Contract `5076b32` permits this creation-mode/X_OK profile;
`d25cb3f` applies the intentional test-expectation delta, not a source fix. The
earlier RED evidence in `tests/stress/adapters/evidence/four-reds-b2d202a` and
`tests/stress/adapters/s3-permission-profile/REPORT.md` remains historical and
unchanged.

An S3 DeleteObject `If-Match` guards the named object's ETag, not the emptiness
of its prefix. A future safe provider integration would need an authoritative
empty-namespace deletion operation or coordination covering every possible writer;
no current injected transport capability supplies that guarantee. No locking or
new provider API is added here. ETag ABA, non-atomic rename and snapshot limits
continue to apply. Primary API reference:
`https://docs.aws.amazon.com/AmazonS3/latest/API/API_DeleteObject.html`.

## Mock and verification

The additive rmdir checkpoint (August 26, 2026) passed all 35 combined S3/WebDAV
rmdir tests and all 503 combined adapter tests, with zero failures or skips:
`node --unhandled-rejections=strict --import tsx --test 'tests/fs/s3/*.test.ts' 'tests/fs/webdav/*.test.ts'`.
Strict NodeNext source-and-test typechecking for both owned adapter directories
also passed. At that historical checkpoint `tests/fs/s3/rmdir.test.ts` covered typed errors and requested
paths, explicit/implicit nonempty directories, empty-prefix rejection with and
without conditional delete, post-list child creation, no mutation requests,
pre-abort and uncooperative in-flight cancellation with late rejection, and
unchanged nonrecursive `rm`. This is mock-backed evidence, not a live-provider
atomicity or product-wide acceptance claim.
The approved snapshot-profile implementation intentionally replaces the three
old empty-marker refusal/marker-preservation expectations while retaining every
nonempty and no-child-loss assertion. Exact old input and test delta are retained
under `tests/fs/s3/rmdir-real-service/snapshot-profile/`.

`MockS3Client({ buckets, pageSize?, now?, authorize? })` stores flat, independently
copied binary objects. It supports conditional requests, common-prefix grouping,
UTF-8 sorting, scoped opaque pagination tokens, missing bucket/key errors,
idempotent unconditional deletion, source-copy conditions, and user metadata copying.
Conditional delete of a missing object reports `NoSuchKey`; `IfMatch: "*"`
requires an existing object. Its ETags
are quoted MD5 values for its simple unencrypted objects; the adapter never
assumes ETags are MD5. `requests` returns an independent request-history snapshot.
`authorize(request)` is an explicit test hook before access/mutation, not an IAM
engine. It can reject selected operations or inject failures. For copy policy,
inspect both the destination and the encoded `CopySource`.
Streaming calls are recorded as underlying `getObject`/`putObject` operations;
streaming PUT history uses an empty placeholder Body, not captured upload bytes.
Upload conditions are evaluated after consuming the staged body so deterministic
concurrent-winner tests exercise commit-time failure. The mock enforces the 2-KiB
user-metadata budget and supports metadata-replacement/destination-guarded copies.

Run the focused conformance, race, byte, authorization, and pagination tests:

```sh
node --import tsx --test 'tests/fs/s3/*.test.ts'
npm run typecheck
```

No AWS credentials or network service are required by these tests. Verification
against a live S3-compatible service remains a separate integration gate.

Review-follow-up validation on August 26, 2026: all 83 focused tests passed,
including 13 new copy-race/namespace regressions and three 500-operation seeded
model comparisons. `npm run typecheck` and an isolated strict NodeNext S3
typecheck also passed. The 13-test race suite passed ten additional repetitions
with `--unhandled-rejections=strict` (130 test executions). These are backend
correctness results, not a product-completion, 72-hour-work, or superiority claim.
That paragraph records the earlier 83-test revision, not the current test count.

## Production verification

Source-owner checkpoint `1c846a1` (August 26, 2026): the unchanged required S3 matrix
improves from 1/11 to 11/11; unchanged shared S3 conformance passes 50/50.
Focused backend tests pass 87/87 with the historical default-rename assertion
retained as explicit opt-out policy and obsolete stream-stub assertions replaced
by actual stream/missing-file behavior. Source-only strict typecheck passes.
Root-import test typechecking encountered concurrent wrapper errors; this is not
a whole-repository pass. Named gzip stdout works; staged named-file gzip still
requires creation-mode support and remains follow-up work at this checkpoint.
The independent foreign stress assertion that default rename rejects is not
edited; the default-policy change intentionally supersedes that assertion.

Final follow-up on Node v22.22.2: 126/126 owned backend tests, 50/50 unchanged
shared S3 conformance cases, and 11/11 required S3 matrix cases pass, with no skips
or TODOs. The 38 streaming/mutation regressions pass five extra strict-rejection
repetitions (190 test executions). Staged named-file gzip, decompression, existing
file touch and conditional destination races are now covered. Owned strict
NodeNext typechecking (including root-import tests) and `npm run typecheck` pass.
The unchanged independent adapter stress suite is 18/19: its sole failure is the
historical assertion at `tests/stress/adapters/s3.test.ts:106` that default rename
must reject. No other stress failure is treated as an exception, and this is not
a whole-suite pass or a real-cloud integration claim.

No shared contract change or export edit was required. Wrapper consumers should
discover optional stream methods and their declared flags; do not assume that
every S3-shaped transport provides streams. The extra streaming input/output
types live in `transport.ts`; consumers can infer them through `S3Transport`'s
methods without an additional barrel export.

The root separately committed diagnostic-only matrix updates in `d0fed8f` during
this follow-up, then added direct FsError/namespace-preservation assertions in
its working tree. The S3 owner did not edit the matrix or its fixtures. Its
required flows/denominators are unchanged and error coverage is stronger, but
final matrix bytes differ from the original checkpoint. SHA-256 validation inputs:

```text
matrix.test.ts: a4f79a93aae64a91fe764da7b9a2c096c8dd93a76fcdcc522828aea670a241f2
fixtures.ts: 59ac2d1835ff329d0bbd08e3ae28bc8c656145e5bb568e6dbca0e851367cb3ab
shared.test.ts: 25faf6e3d42794be5bc7a76fef7ef7f651e7bcb5bab23c98bb6ca80031ec525b
stress/adapters/s3.test.ts: e75c711b9e4f71a0a144b86cf53c09a95d3d105880dc21956fa16066d340828b
```

```sh
node --unhandled-rejections=strict --import tsx --test tests/fs/s3/*.test.ts
node --unhandled-rejections=strict --import tsx --test --test-name-pattern='^s3:' tests/fs/conformance/shared.test.ts
node --unhandled-rejections=strict --import tsx --test --test-name-pattern='^s3:' tests/integration/adapter-tools/matrix.test.ts
node --unhandled-rejections=strict --import tsx --test tests/stress/adapters/s3.test.ts
```

Remaining provider limits: single-request upload/copy ceilings; transport-owned
signing, streaming encoding and credentials; no distributed namespace/metadata
lock, directory transaction or crash rollback; no historical-version interface,
IAM/ACL emulation, multipart implementation, or preservation promise for service
metadata/encryption/retention policies. Forced gzip replacement still correctly
requires atomic rename and is unavailable; use a new destination or explicit
application reconciliation rather than misadvertising `atomicRename`.

## Primary protocol references

### Rename guard remediation, August 26, 2026

Independent Curie review `dda1782` recorded 39/42 passes and three failures on
archive `677e03c` (three runs). The defect was a successful unconditional copy
followed by source deletion when only conditional deletion was declared. That
unsafe branch is removed; conditional-PUT-capable transports now use the real
fallback above rather than being disabled or assigned fictional copy support.

Verification on Node v22.22.2, without credentials or cloud requests:

- Existing 126 backend cases plus 34 new rename cases: **160/160 pass**.
  The new cases include the three exact archived vectors, guarded buffered and
  streaming publication/replacement, destination/source races, deletion and
  lost-acknowledgement failures, preflight budgets, cancellation and cleanup.
  Six cases explicitly reproduce the two residual limitations across three
  publication paths; their passes establish the observations, not stronger
  generation/snapshot safety.
- Unchanged `tests/stress/s3-policy/rename.test.ts`: **42/42 pass**, including
  three additional strict-rejection runs (126 passing test executions).
- Unchanged shared S3 conformance: **50/50 pass**.
- Selective aggregate S3 matrix: **11/11 pass**.
- Strict owned NodeNext typecheck and `npm run typecheck`: **pass**.
- Unchanged `tests/stress/s3-policy/observe.ts` still reports successful ABA with
  `keys: ["target"]`, matching original/replacement ETags and target metadata
  `{ "generation": "old" }`; the directory probe still reports successful
  rename with `keys: ["source/new", "target/old"]`.

No independent policy tests, archive evidence, other adapters, commands, shared
contracts or matrix fixtures were edited. No shared-contract change is needed
for the guard fix; the existing injected transport hooks carry the real
conditional operations. Stronger generation guarantees remain separate work.
Independent policy test SHA-256:
`0ddf732f04c3e5bb78b7569ec80d442cf9f4b4158a4360a88e774f639de81fd7`.

Current AWS protocol documentation was rechecked for this remediation. The
October 29, 2025 conditional-copy announcement and current CopyObject API
document destination `If-Match`/`If-None-Match`, distinct from the source
`x-amz-copy-source-if-match`. The older enforcement-guide note claiming 501 for
destination conditional copy conflicts with those sources; it does not justify
an unconditional fallback. PutObject documents real destination ETag/existence
preconditions. Conditional-delete guidance specifies current-object evaluation;
DeleteObject documents version-specific permanent deletion separately. Actual
support must still be explicitly negotiated for each S3-compatible provider.

Read during implementation on August 26, 2026:

- `https://docs.aws.amazon.com/AmazonS3/latest/API/API_ListObjectsV2.html`
  — prefix/delimiter grouping, common-prefix counting, continuation tokens.
- `https://docs.aws.amazon.com/AmazonS3/latest/API/API_CopyObject.html`
  — single-copy limits, source preconditions, complete-response/embedded errors.
- `https://docs.aws.amazon.com/AmazonS3/latest/userguide/copy-object.html`
  — move/rename as copy followed by deletion, metadata implications.
- `https://docs.aws.amazon.com/AmazonS3/latest/API/API_PutObject.html`
  — binary bodies and conditional writes.
- `https://docs.aws.amazon.com/AmazonS3/latest/API/API_DeleteObject.html`
  — conditional deletion and versioned-bucket limitations.
- `https://docs.aws.amazon.com/AmazonS3/latest/userguide/conditional-deletes.html`
  — ETag/existence checks and missing-object/concurrent-delete failures.
- `https://docs.aws.amazon.com/AmazonS3/latest/userguide/conditional-writes.html`
  — missing-object failures for ETag-guarded writes.
- `https://docs.aws.amazon.com/AmazonS3/latest/API/API_GetObject.html`
  — IfMatch-pinned reads, single HTTP ranges, permission-sensitive 403/404 errors.
- `https://docs.aws.amazon.com/AmazonS3/latest/userguide/add-object-metadata.html`
  — user metadata replacement versus service-controlled LastModified.
- `https://docs.aws.amazon.com/AmazonS3/latest/userguide/UsingMetadata.html`
  — 2-KiB user-metadata budget and ETags independent of metadata-only changes.
- `https://aws.amazon.com/about-aws/whats-new/2025/10/amazon-s3-conditional-write-functionality-copy-operations/`
  — destination conditional copy announced October 29, 2025. Current API and
  conditional-writes references document destination IfMatch/IfNoneMatch. An
  older conditional-writes-enforce guide still says these return 501; that stale
  note conflicts with the dated announcement/current API. Generic S3-compatible
  providers must explicitly negotiate actual support, never inherit an AWS claim.
