# Bounded transactional S3 namespaces

`createS3NamespaceFileSystem(options)` is an explicit alternative to the flat-key
`S3FileSystem`, exported from `@poe-platform/safe-fs/fs/s3` and the package root.
It stores a complete bounded filesystem namespace in **one dedicated manifest
object**. Directory membership, file bytes and inode generations change together
in a verified conditional PUT. It never lists a bucket prefix or recursively
deletes unrelated S3 keys.

This is a different storage format, not a transparent upgrade or migration of a
flat-key filesystem. Use a new, dedicated object key. Do not mix these operations
with raw overwrites, restored manifests, another implementation or direct editing
of that object. The client, its credentials and the store's conditional-write
guarantees are trusted host inputs. The adapter is not a sandbox for host code.

```typescript
import { createS3NamespaceFileSystem } from '@poe-platform/safe-fs/fs/s3';

const fs = await createS3NamespaceFileSystem({
  client: verifiedS3Transport,
  bucket: 'application-workspaces',
  key: 'isolated-workspace/namespace.json',
  maxBytes: 1024 * 1024,
});
```

The transport must advertise `conditionalPut: true`, `streamingRead: true` and
implement `getObjectStream`. The operator must independently verify that the
actual service atomically enforces `If-Match` and `If-None-Match: *` under
concurrent writes. An advertised capability alone does not qualify a service.
Missing enforcement or streaming support is refused before namespace I/O.
Creation uses `If-None-Match: *`; an existing manifest is parsed and bounded.
Replacing its identity or removing it after initialization fails closed.

## Options and limits

No product environment variables are read. All options are explicit:

| Option | Default / meaning |
| --- | --- |
| `client` | Required S3 transport, including explicit authentication and endpoint policy. |
| `bucket` | Required nonempty bucket name. |
| `key` | Required nonempty dedicated manifest object key. |
| `maxBytes` | 1 MiB; total committed file bytes, positive integer up to 64 MiB. |
| `maxEntries` | 1,024; total files/directories including root, positive integer up to 65,536. |
| `maxManifestBytes` | 8 MiB; bounded serialized reads and writes, positive integer up to 256 MiB. A conservative encoding bound is admitted before JSON allocation, so this can reject a namespace before its content-byte limit is exhausted. |
| `maxAttempts` | 8; conditional commit attempts, positive integer up to 64. Exhaustion returns `EAGAIN`, never an unconditional overwrite. |
| `maxOpenFiles` | 16; shared immutable descriptor admission for this adapter instance. |
| `maxFileBytes` | `maxBytes`; descriptor file-size ceiling, also subject to namespace limits. |
| `chunkBytes` | 65,536; descriptor staging page size, positive integer up to 1 MiB. |
| `maxStagedBytes` | 8 MiB; shared descriptor dirty-page budget. |
| `maxStagedPages` | 4,096; descriptor staging page-count bound. |

The latter five options use the existing object-file-descriptor contract;
integer bounds are validated before initialization. Namespace limits count
committed bytes/entries, not total process RSS. Reads, encoding and immutable
descriptor snapshots also consume bounded host memory. Every mutation reads and
conditionally replaces the manifest: this is intended for bounded workspaces,
not large buckets or a substitute for a scalable transactional storage service.
Different clients must agree on the namespace's operational limits.

## Filesystem and cleanup semantics

Directories are explicit. Files support binary reads, ordinary/exclusive writes,
append, copy, rename and versioned descriptors. All namespace mutations,
including complete tree removal, have a single conditional PUT commit point.
Concurrent clients retry only a failed conditional commit against fresh state.
Transport failures with an uncertain commit outcome are reported, not retried as
an unconditional mutation. Cancellation cannot undo acknowledged effects.

Conditional cleanup checks the observed root and parent inode identities in
the same transaction. Nonrecursive conditional entry removal also checks the
observed revision and metadata. Missing identity evidence is `ENOTSUP`; a known
replacement or stale revision is `EAGAIN`. Root removal and terminal `.`/`..`
entry removal are refused. Resolution checks each traversed directory before
reducing `..`; a trailing slash cannot name or create a regular file.

Inode numbers are durable within the manifest, but observations are scoped to
the adapter instance that issued them. The partial identity is **not** a claim
of complete global device/inode identity across arbitrary transports or aliases.
Do not serialize an observation and treat it as fresh authority in another
adapter. Cross-view comparisons without authoritative evidence remain unknown.

The existing `withObjectFileDescriptors` implementation supplies immutable read
versions and conditional write publication. An already-open reader retains its
snapshot after removal; a stale writer cannot resurrect or overwrite a renamed,
removed or replaced entry. This is explicitly the versioned-descriptor profile,
not POSIX inode-following writes. Close/sync failures remain observable and
release owned staging/reader resources through the descriptor lifecycle.

Symlinks, hardlinks, enforced POSIX modes, timestamp setters and ZIP staging are
not advertised. Modes and times are namespace metadata, not OS permissions.
Readonly, quota and mount composition retain their own policies; the Python
bridge selects tree cleanup only when the effective path exposes its capability.
The ordinary flat-key S3 and stock WebDAV adapters remain unable to provide
authoritative whole-tree removal and must continue refusing that operation.

## Real service acceptance

The maintained opt-in test is
`packages/safe-bash/tests/integration/python-s3-namespace.test.mjs`. It requires a
fresh installed public consumer and an already-qualified Docker Python image,
plus an explicitly configured S3 test service and disposable bucket. It verifies
exclusive creation and concurrent conditional writes before testing real Python
binary files, normal/exceptional temporary-directory cleanup, replacement races,
readonly/quota/mount boundaries and cancellation before publication.

Test-only environment variables are `SAFE_BASH_PUBLIC_CONSUMER_ROOT`,
`SAFE_BASH_DOCKER_IMAGE`, `SAFE_BASH_DOCKER_SOCKET`,
`SAFE_BASH_S3_NAMESPACE_ENDPOINT`, `SAFE_BASH_S3_NAMESPACE_BUCKET`,
`SAFE_BASH_S3_NAMESPACE_ACCESS_KEY_ID` and
`SAFE_BASH_S3_NAMESPACE_SECRET_ACCESS_KEY`. Test keys are UUID-scoped and removed
individually. No bucket or prefix cleanup is performed. Unencrypted HTTP is
admitted only for an explicit loopback test endpoint. Local service acceptance
does not automatically qualify a different S3 vendor or deployment topology.
