# safe-fs (`poe-code/safe-fs`)

Shared, filesystem-only TypeScript ESM adapters extracted from `safe-bash`
(package name `virtual-bash`). This is a **transitional foundation** with no
runtime package dependencies. The `@poe-code/safe-fs` workspace remains private
at `0.0.0-dev`; public consumers use `poe-code/safe-fs` from the root poe-code
distribution, not a separately published scoped package. This release candidate
still requires installed-artifact verification and GitHub publication. Runtime
consumer migration and removal of old copies are not complete.

The package contains the existing implementations, not alternative backends.
In particular, `RealFileSystem({ root })` is the existing machine-directory
adapter. There is no shell, plugin registry, interpreter, runtime host-call
dispatcher, or implicit filesystem selection.

## Exports

The intended public import after release is `poe-code/safe-fs`. Its root exports:

- `FileSystem`, `FileSystemFactory`, `FileSystemCapabilities`, `FileStat`,
  `FileType`, `DirectoryEntry`, `EntryComparison`, `FsOptions`,
  `ReadFileOptions`, `WriteFileOptions`, `AppendFileOptions`, `MkdirOptions`,
  `RemoveOptions`, `CopyFileOptions`, `ReadStreamOptions`, and `ACCESS_MODES`.
- `FsError`, `FsErrorOptions`, `ErrnoCode`, `isFsError`, `isErrnoCode`, and
  `toFsError`. Error recognition uses the canonical constructor, not duck typing.
- `MemoryFileSystem` / `createMemoryFileSystem`, `RealFileSystem` /
  `createRealFileSystem` / `RealFileSystemOptions`, `ReadOnlyFileSystem` /
  `createReadOnlyFileSystem`, `MountFileSystem` / `createMountFileSystem` /
  `MountFileSystemOptions`, and `OverlayFileSystem` / `createOverlayFileSystem` /
  `OverlayFileSystemOptions`.
- `S3FileSystem`, `S3FileSystemOptions`, `S3RenameError`, `MockS3Client`,
  `MockS3ClientOptions`, `MockS3Operation`, `MockS3Request`, `createS3Transport`,
  `encodeCopySource`, and `S3ServiceError`.
- S3 transport types: `S3Body`, `S3Client`, `S3Transport`,
  `S3TransportCapabilities`, `S3RequestOptions`, `S3ObjectInput`, `S3HeadOutput`,
  `S3GetOutput`, `S3PutInput`, `S3DeleteInput`, `S3CopyInput`, `S3CopyOutput`,
  `S3ListInput`, `S3ListOutput`, `S3ObjectSummary`, `S3StreamGetInput`,
  `S3StreamGetOutput`, and `S3StreamPutInput`.
- `createS3HttpTransport`, `S3HttpTransportOptions`, `S3HttpCredentials`,
  `S3HttpCredentialProvider`, and `S3HttpRequestFactory`.
- `WebDavFileSystem`, `WebDavFileSystemOptions`, `WebDavFetch`,
  `WebDavAtomicEmptyDirectoryBinding`, `WebDavAtomicEmptyDirectoryRequest`,
  and `WebDavAtomicEmptyDirectoryResult`.
- `createNodeFsBridge`, `NodeFsBridgeOptions`, `NodeFsBridgeFileSystem`, and
  `NodeFsImplementation`.
- `ByteSource`, `CollectOptions`, `readBytes`, `collectBytes`, `toByteSource`,
  `posixPath`, `basename`, `dirname`, `extname`, `joinPath`, `isAbsolutePath`,
  `validatePath`, `resolvePath`, `normalizePath`, `relativePath`, `isPathWithin`,
  and `assertPathWithin`.

Private workspace development subpaths are `/contracts`, `/node`, `/fs/memory`, `/fs/real`, `/fs/s3`,
`/fs/s3/http`, `/fs/webdav`, `/fs/readonly`, `/fs/mount`, and `/fs/overlay`.
These are not additional public `poe-code/safe-fs/*` exports. Within the workspace,
they re-export the same modules as the root; constructors and authority registries
are not recreated. Streaming S3 request/output types are available from the root.
Internal authority-registration helpers are deliberately not public exports.

```ts
import {
  createNodeFsBridge,
  MemoryFileSystem,
  RealFileSystem,
} from "poe-code/safe-fs";

const memory = new MemoryFileSystem();
await memory.writeFile("/note", new TextEncoder().encode("hello"));

const machine = new RealFileSystem({ root: "/absolute/existing/directory" });
const nodeFs = createNodeFsBridge(machine, { cwd: "/" });
await nodeFs.readFile("note", "utf8");
```

`cwd` above is virtual; it does not change the configured host root. Constructing
the machine adapter does not create its directory. `createRealFileSystem` is
async and checks the root before returning. Its existing string-root shorthand
and the constructor's string-root shorthand are retained.

## Filesystem contract

Paths are strings in each adapter's virtual namespace; file data is `Uint8Array`.
`ByteSource` is `AsyncIterable<Uint8Array>`. `readBytes(source, signal?)` preserves
iterator cleanup/cancellation, and `collectBytes(source, { maxBytes, signal? })`
copies retained chunks and bounds the result. `toByteSource` accepts a string or
byte array and takes ownership through a copy. No shell pipe/sink APIs are exported.

All operation-option objects accept an optional `signal`. Additional fields:

| Options | Fields |
| --- | --- |
| `ReadFileOptions` | `maxBytes`: maximum buffered read size; adapter limits still apply |
| `WriteFileOptions` | `flag`: `w` (default), `wx`, `a`, or `ax`; optional creation `mode` |
| `AppendFileOptions` | optional creation `mode` |
| `MkdirOptions` | `recursive` (default false), optional creation `mode` |
| `RemoveOptions` | `recursive` and `force` (default false) |
| `CopyFileOptions` | `exclusive` (default false) |
| `ReadStreamOptions` | `start` (default zero), optional `endExclusive`, optional `chunkSize` |
| `FsOptions` | only `signal` |

Direct adapters can apply backend-specific validation/defaults. Check
`capabilities` and optional methods rather than assuming POSIX support. Flags
include `readOnly`, `symlinks`, `hardlinks`, `permissions`, `timestamps`,
`atomicRename`, `snapshotRmdir`, `streamingRead`, and `streamingWrite`; unknown
capabilities can be absent. `rmdir` is optional: unsupported strong empty-only
removal must not become recursive deletion.

`FileStat` preserves optional allocation, timestamps, ownership and identity
metadata. `allocatedBytes` is provider-reported, not logical size or unique
physical storage. Missing values stay unknown. `identityScope` compares by
reference and means disjoint backing storage, not merely a different endpoint,
protocol, or client. `compareEntry` returns `same`, `distinct`, or `unknown`;
unknown/conflicting authority must not be silently promoted to destructive safety.
These observations are not leases, transactions, or ABA protection. The preserved
source contract is in `src/contracts/filesystem.md`.

## Adapter configuration

### Memory and machine directory

`MemoryFileSystem()` / `createMemoryFileSystem()` have no configuration.

`RealFileSystemOptions.root` is required: an existing absolute host directory.
The adapter resolves its canonical root, interprets input paths as virtual paths,
and checks traversed symlinks against that root with a 40-link traversal limit.
Host absolute symlink targets must be within the canonical root; `readlink`
translates admitted absolute targets back into virtual paths. Final-link
operations such as `lstat` and removal operate on the link itself.

**This is not a race-proof sandbox.** Path validation and subsequent Node file
operations are separate. `O_NOFOLLOW` narrows final-file open races, but ancestor
swaps, concurrent renames, mount changes, and preexisting hardlinks can defeat
path confinement. An untrusted process modifying the tree requires OS isolation.
Only regular files, directories, and symlinks are represented. Permissions,
umask, case sensitivity, allocation, ownership and rename behavior are host-specific.
Copy is not atomic; rename may fail with `EXDEV`. Cancellation is cooperative,
not rollback, and can leave partial files. No native commands are executed.

### Composition

- `ReadOnlyFileSystem(filesystem)` / `createReadOnlyFileSystem(filesystem)` take
  an explicit backing filesystem and reject mutations with `EROFS`. Metadata
  and authority are forwarded without promising mutable capabilities.
- `MountFileSystem({ root, mounts? })` takes a root filesystem and an optional
  record of virtual mount paths to filesystem instances. There is no provider
  selector. Mount routing and cross-backend identity guards are the extracted
  implementation; a mounted namespace does not establish physical isolation.
- `OverlayFileSystem({ upper, lower, maxBufferBytes? })` requires both layers.
  `maxBufferBytes` defaults to 64 MiB. Reads prefer the upper layer; copy-up and
  whiteouts isolate overlay mutations from the lower layer. Copy-up can refuse
  hardlinks or unknown identity rather than corrupt aliases. Hidden upper-layer
  staging paths retain the `/.virtual-bash-overlay-` prefix. This is not a
  transactional filesystem; upper-layer visibility and cleanup are backend-dependent.

Factories accept the same options as their corresponding constructors.

### S3 filesystem and injected transports

`S3FileSystemOptions`:

| Field | Meaning/default |
| --- | --- |
| `transport` | Required explicit `S3Transport` |
| `bucket` | Required bucket name |
| `prefix` | Canonical relative object-key prefix; default empty |
| `compareEntry` | Optional trusted backing-identity resolver; no inferred endpoint identity |
| `readOnly` | Default false |
| `allowNonAtomicRename` | Default true; copy/delete rename is not atomic |
| `pageSize` | Default 1000, range 1–1000 |
| `maxReadBytes` | Default 64 MiB, nonnegative safe integer |
| `maxStreamBytes` | Default and maximum 5,000,000,000 bytes |
| `maxListEntries` | Default 100,000, positive safe integer |

Permissions are advisory (`permissions: false`); `chmod` is unsupported. Metadata
keys `virtual-bash-mode`, `virtual-bash-atime`, and `virtual-bash-mtime` are retained
without renaming. Rename can leave destination copies or partial source deletions;
`S3RenameError` reports `phase`, `copiedKeys`, and `deletedKeys`.

S3 advertises the weaker `snapshotRmdir` profile: an empty listing followed by
conditional marker deletion, not atomic removal-time emptiness or guaranteed
directory absence. Compositions must preserve that weakness or refuse the operation.

`createS3Transport(client, capabilities = {})` adapts an explicit S3-shaped client.
Capabilities are `conditionalPut`, `conditionalCopy`, `conditionalDelete`,
`streamingRead`, and `streamingWrite`; unasserted capabilities are not verified.
The package includes no AWS SDK or provider-selection logic. `S3RequestOptions`
uses `abortSignal`; filesystem options use `signal`.

`MockS3Client({ buckets, pageSize?, now?, authorize? })` is in-memory. `buckets`
is required; `pageSize` defaults to 1000 (1–1000); `now` defaults to the system
clock; optional `authorize(request)` may reject synchronously or asynchronously.
`requests` exposes copied request history. Mock success is not service acceptance.

### S3 HTTP transport

`createS3HttpTransport(options)` implements signed HTTP using Node builtins:

| Field | Meaning/default |
| --- | --- |
| `endpoint` | Required HTTP(S) origin, no path/query/fragment/userinfo |
| `region` | Required explicit signing region |
| `credentials` | Required explicit credentials or async `({ signal }) => credentials` |
| `addressingStyle` | `path` (default) or `virtual-hosted` |
| `listUrlEncoding` | `percent` (default) or explicit provider-profile `form` decoding |
| `clock` | Optional signing clock; default system clock |
| `request` | Optional trusted Node-compatible request factory |
| `allowInsecureHttp` | Default false; required for HTTP |
| `maxPutBytes`, `maxGetBytes` | Each defaults to 64 MiB, positive, maximum 1 GiB |
| `maxXmlBytes` | Default 4 MiB, positive, maximum 16 MiB |
| `requestTimeoutMs` | Default 30,000; positive, maximum 2,147,483,647 |
| `enableCopy` | Default true |
| `verifiedConditionalOperations` | Optional `{ put?, copy?, delete? }`; each defaults false |

Credentials contain `accessKeyId`, `secretAccessKey`, and optional `sessionToken`.
A credential provider is called per operation; refresh and caching are host-owned.
The timeout covers credential acquisition and response consumption. There is no
region discovery, automatic retry, redirect following, multipart implementation,
or credential discovery. Conditional flags are explicit host assertions of actual
provider enforcement, not capabilities inferred from successful HTTP responses.
Unknown conditional support fails closed; native COPY support may use the existing
bounded conditional-PUT fallback when appropriately configured. Streaming GET is
supported; HTTP streaming PUT is not advertised.

### WebDAV

`WebDavFileSystemOptions`:

| Field | Meaning/default |
| --- | --- |
| `baseUrl` | Required explicit HTTP(S) collection URL |
| `fetch` | Required trusted `(url, init) => Promise<Response>`; no global fallback |
| `headers` | Optional explicit headers, copied at construction |
| `maxResponseBytes` | Default 64 MiB, positive safe integer |
| `maxXmlBytes` | Default 2 MiB, positive safe integer |
| `maxEntries` | Default 10,000, positive safe integer |
| `timeoutMs` | Default 30,000; positive, maximum 2,147,483,647 |
| `overwritePolicy` | `lock` (default) or `etag` |
| `atomicEmptyDirectory` | Optional trusted namespace-bound strict empty-directory remover |
| `compareEntry` | Optional trusted backing-identity resolver |

Explicit `Authorization` or `Cookie` headers require HTTPS. URL userinfo,
queries, fragments, and protocol-control header overrides are rejected. Requests
use `credentials: "omit"` and `redirect: "manual"`. Only a single PROPFIND
trailing-slash canonicalization within the same namespace may be followed;
other redirects are rejected. The injected transport must honor those rules:
the adapter cannot undo unauthorized I/O by dishonest host code. DNS, proxies,
TLS trust, server aliases, and remote authorization remain host/provider concerns.

The optional `atomicEmptyDirectory` binding contains the canonical `namespaceUrl`
and `removeEmptyDirectory(request)` callback. Requests use
`operation: "atomic-empty-rmdir/v1"`, `namespaceUrl`, virtual `path`, and optional
`signal`; success must return matching fields and `outcome: "removed"`. Without
the binding, strict `rmdir` is unsupported. A normal recursive WebDAV DELETE is
not a valid binding. Receipt validation is not proof against a dishonest host.

The `urn:virtual-bash:metadata` timestamp property, JSON payload version, ETag
binding and DAV resource-id comparison are preserved. PUT streaming uses an
explicit Fetch `duplex: "half"` body. Cancellation bounds outward waits but cannot
forcibly stop uncooperative transports or undo accepted remote operations.

## Neutral Node bridge

`createNodeFsBridge(filesystem, { cwd?, signal? })` exposes `NodeFsImplementation`,
a Node-promises-shaped subset. `cwd` defaults to `/` and must be an absolute
virtual path. It is path resolution context, **not confinement**: absolute paths
and parent traversal can address other locations in the backing virtual namespace.
`signal` applies to operations and combines with per-read/write cancellation.

Methods: `access`, `appendFile`, `chmod`, `copyFile`, `cp`, `link`, `lstat`,
`mkdir`, `mkdtemp`, `readFile`, `readdir`, `readlink`, `realpath`, `rename`, `rm`,
`rmdir`, `stat`, `symlink`, `truncate`, `utimes`, and `writeFile`.

Node-style encodings, Buffer/string results, directory predicates, numeric stats,
and millisecond conversion are adapted. Unknown options are rejected. Bigint
stats, file handles, flushing, retries, cp symlink/dereference/timestamp-preservation
options, and unsupported copy flags are not implemented. Optional backing methods
remain optional: missing `rmdir` does not become recursive deletion.

The bridge is not complete Node `fs` emulation. Its existing stats adapter fills
missing Node numeric fields and computes `blocks` from logical size; use raw
`FileStat.allocatedBytes` when provider allocation matters. Bridge-created option
errors and cancellation errors are not necessarily `FsError`. `makeSafeJsFsModule`
is intentionally absent: the runtime owns module construction and confinement.

## Environment and compatibility

**No package environment variables.** The package does not read ambient
credentials, home-directory configuration, metadata services, or process working
directory for default authority. Root, endpoints, credential providers, transports,
headers, and backing filesystems are explicit. Node's host filesystem, network
stack, clock and TLS configuration still apply; injected host callbacks are trusted.

The source repository declares Node >=22. This extraction emits ES2022 ESM and
does not change the root workspace's Node >=18.18 declaration. Focused tests run
on Node 18.18.2, 20.20.0, 22.22.2, and 24.14.0. Cancellation composition does not
require `AbortSignal.any`: the internal operation-scoped helper uses standard
`AbortController` and event listeners, without Node imports or global patches.
Paired tests remove and restore `AbortSignal.any` to exercise the capability gap
on Node 19 and early Node 20; those versions are not silently excluded from the
root engine range. This is a capability simulation, not a full runtime matrix.

Composed signals preserve the first observed abort reason by identity and the supplied
input order when inputs are already aborted. Subscriptions are deduplicated and
removed on abort, completion, failure, setup failure, or iterator return. Cleanup
does not abort borrowed inputs. Existing error-code mappings remain in place;
native read cleanup now preserves an active primary error or cancellation reason
instead of masking it with a close failure. A composed signal's original reason
does not imply that every public
method throws that reason directly.

Browser runtime is a required consumer-build target. The cancellation helper is
independently checked with DOM libraries and no Node ambient types, and runs as
ESM with native browser cancellation primitives. The strict DOM source-alias
check uses the canonical consumer route `poe-code/safe-fs`. WebDAV streaming
uploads retain `duplex: "half"` through a local request-type intersection; global
DOM `RequestInit` is not augmented. A properly built browser entry must still
handle the package's existing Node-specific modules and explicit transports.
These helper/type checks do not certify the complete browser bundle, native-disk
adapter in browsers, or deployed-provider behavior; consumer build verification
remains separately owned.

The bridge retains its legacy `Dirent.path` property alongside `parentPath`; a
type-only assertion accommodates the workspace's newer Node declarations without
removing that runtime property. Both the Node-only source check and the mixed
DOM/Node source-alias check validate the streaming request adaptation.

## Provenance and validation

`PROVENANCE.json` records source/destination paths and SHA-256 hashes from source
HEAD `697ad092de111642aa376f74560da9927a0c9512`, with 31 upstream provenance
records across the 51-file foundation. Of the 23 extracted `src/fs/**/*.ts`
files, 17 remain byte-identical and six are transformed: mount, overlay, native
disk, S3 filesystem, S3 HTTP transport, and WebDAV. The transformations include
cancellation lifetime, cleanup error precedence, and lint corrections; WebDAV
also has the local DOM-compatible streaming-request type. Mount comparison/identity
registries, private S3 authority, WebDAV resource-id bindings, and native identity
symbols remain unchanged. Filesystem, error and path contracts and the filesystem
contract document are also preserved.

Only filesystem-neutral byte-source helpers are selected from `contracts/io.ts`.
The Node bridge drops `makeSafeJsFsModule`, renames the structural type to
`NodeFsImplementation`, adjusts imports, removes an unused string validator, and
adds the type-only Dirent assertion. Existing metadata names, native identity
symbol and overlay staging prefix deliberately retain their original names.
The bridge now disposes composed per-call signals. `src/contracts/abort.ts` and
`src/contracts/cleanup.ts` are new package-owned helpers, not upstream
extractions. Provenance records their hashes and each transformed extraction.
Native read cleanup preserves an active read error, injected consumer error, or
cancellation reason when closing also fails; close failures still surface after
successful completion or iterator return. Seventeen cleanup regression cases
cover this behavior and wrapper cleanup using in-memory fixtures.

Use the root Vitest binary with explicit package-owned files only:

```sh
node_modules/.bin/vitest run packages/safe-fs/tests/public-imports.test.ts packages/safe-fs/tests/contracts.test.ts packages/safe-fs/tests/node-bridge.test.ts packages/safe-fs/tests/network-adapters.test.ts --maxWorkers=1 --no-cache
node_modules/.bin/tsc -p packages/safe-fs/tsconfig.json --noEmit
node_modules/.bin/tsc -p packages/safe-fs/tsconfig.tests.json
node_modules/.bin/vitest run packages/safe-fs/tests/abort-scope.test.ts packages/safe-fs/tests/abort-signal-compatibility.test.ts --maxWorkers=1 --no-cache
node_modules/.bin/tsc -p packages/safe-fs/tsconfig.browser.json
node_modules/.bin/tsc -p packages/safe-fs/tsconfig.browser-helper.json
```

Host-file mutation tests use memfs. The fixture supplies memfs's numeric open
flags and corrects its append-position behavior; it does not certify native
host behavior or race safety. HTTP tests use loopback; WebDAV uses injected
responses. Neither is an independent deployed-provider acceptance test.

The canonical consumer route is **`poe-code/safe-fs`**, intended to provide one
filesystem module graph for consumers resolving the same poe-code installation.
This foundation-only candidate does not migrate SafeJS or safe-bash consumers.
The private workspace name is transitional, not a separate
npm bootstrap requirement. No sibling `file:` dependency, second bundled identity,
private registry bypass, or local publication is introduced here. Root config,
build/release integration, browser packaging and consumer re-exports are
separately owned.
Old copies must remain until consumer integration is verified, then be removed;
while those copies remain this is not a completed deduplication. Validate real
providers and supported host profiles before treating release integration as done.
