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

Import from this directory's `index.ts` in source, or the corresponding compiled
`index.js`. Package-root/subpath export wiring is the coordinator's responsibility.
The required manifest entry, to be added by the manifest owner, is:

```json
"./fs/s3": {
  "types": "./dist/fs/s3/index.d.ts",
  "import": "./dist/fs/s3/index.js"
}
```

That subpath exposes all exports from `src/fs/s3/index.ts`. If package-root imports
are also intended, the root barrel owner must additionally add
`export * from "./fs/s3/index.js";` to `src/index.ts`. No dependency addition is
needed for either integration. This backend does not edit those owned files or
claim the package import works before integration and a build are verified.

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
| `headObject` | `Bucket`, `Key` | `ContentLength`, `LastModified`, `ETag` |
| `getObject` | `Bucket`, `Key` | binary `Body`, `ContentLength`, `ETag`, `Metadata` |
| `putObject` | `Bucket`, `Key`, `Body`, optional `Metadata`, `IfMatch`, `IfNoneMatch` | fulfilled promise |
| `listObjectsV2` | `Bucket`, `Prefix`, `MaxKeys`, optional `/` `Delimiter`, `ContinuationToken` | `Contents`, `CommonPrefixes`, `IsTruncated`, `NextContinuationToken` |
| `copyObject` | `Bucket`, `Key`, URL-encoded `CopySource`, `CopySourceIfMatch`, `MetadataDirective: "COPY"`, optional `IfNoneMatch` | `CopyObjectResult.ETag` |
| `deleteObject` | `Bucket`, `Key`, optional `IfMatch` | fulfilled promise |

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
all three. A service that silently ignores preconditions is not compatible with
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

## Filesystem behavior and limits

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
  supplied. Modes are synthetic `0100644`/`040755`, not authorization checks.
  `atimeMs`, `ctimeMs`, and unknown directory `mtimeMs` are zero. No inode, birth
  time, ownership, or link-count guarantee is made.
- POSIX permissions, explicit creation modes, links and `chmod` remain unsupported.
  `utimes` stores virtual millisecond timestamps in user metadata using guarded
  metadata-replacement copy; it does not change S3's system `LastModified`.
  `truncate` uses bounded conditional read/modify/write and zero-padding.
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

`atomicRename` is always false. `rename` now defaults to useful copy/delete
semantics with a transport declaring `conditionalDelete: true`. Explicit
`allowNonAtomicRename: false` retains fail-before-I/O policy for callers requiring
atomic moves. This is a deliberate default-policy change, not atomic rename.

Rename preflights type conflicts, empty-directory replacement, key lengths, size
limits, and source ETags. It copies every listed object with a source ETag
precondition, waits for each completed copy response, then deletes sources using
their original ETags. It never starts deleting sources after an unconfirmed or
failed copy. A changed source is retained if conditional deletion fails.

This is **not atomic**, not crash-safe, and not an atomic directory snapshot:
other clients can see both names, race with directory checks, overwrite targets,
or add new source keys after enumeration. ETags are opaque content validators,
not version IDs; same-content/metadata-only races can escape ETag checks. External
writers can also create file/prefix collisions between checks and writes. Ordinary
write and removal operations retain their normal overwrite/delete semantics.
Using `mkdir` without conditional put adds a check-then-write marker race.

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
tree-wide isolation must not rely on recursive removal or opt-in rename without
external coordination.
Recursive `mkdir` also creates markers sequentially; if a later request fails,
already-created ancestor markers remain. None of these multi-key operations has
automatic rollback.

Only the current object view is exposed. Versioned buckets may retain historical
versions/delete markers after deletion. The mock represents unversioned,
general-purpose object storage: it does not simulate versioning, IAM evaluation,
ACLs, encryption/KMS, multipart uploads, object lock, billing, network behavior,
S3 Express directory buckets, or transactional directory operations.

## Mock and verification

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
Files remain pending independent final review and the coordinator's separately
authorized atomic backend commit; no commit is made by this follow-up.

## Primary protocol references

Production-flow checkpoint (August 26, 2026): the unchanged required S3 matrix
improves from 1/11 to 11/11; unchanged shared S3 conformance passes 50/50.
Focused backend tests pass 87/87 with the historical default-rename assertion
retained as explicit opt-out policy and obsolete stream-stub assertions replaced
by actual stream/missing-file behavior. Source-only strict typecheck passes.
Root-import test typechecking encountered concurrent wrapper errors; this is not
a whole-repository pass. Named gzip stdout works; staged named-file gzip still
requires creation-mode support and remains follow-up work at this checkpoint.
The independent foreign stress assertion that default rename rejects is not
edited; the default-policy change intentionally supersedes that assertion.

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
