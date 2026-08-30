# safe-fs (`poe-code/safe-fs`)

Shared, filesystem-only TypeScript ESM adapters extracted from `safe-bash`
(package name `virtual-bash`). This is a **transitional foundation** with no
runtime package dependencies. The `@poe-code/safe-fs` workspace remains private
at `0.0.0-dev`; public consumers use `poe-code/safe-fs` from the root poe-code
distribution, not a separately published scoped package. The Node.js foundation
was first published and installed-artifact verified in `poe-code@12.0.3`.
`poe-code@12.0.5` also publishes SafeJS SDK/CLI integration through explicit
adapter injection and filesystem configuration. Its installed public runtime,
types and both CLIs were verified on Node 18.18.2, 18.20.8, 20.20.0,
22.22.2 and 24.14.0. The C changes described below add a **filesystem-only browser
profile**; they are not present in `12.0.5`. C's isolated packed-consumer proof is
complete, but its full release candidate and published-artifact gates remain
separate. Browser SafeJS/safe-bash execution, safe-bash runtime migration, removal
of old copies and the `safe-js` rename remain pending.

The package contains the existing implementations, not alternative backends.
In particular, `RealFileSystem({ root })` is the existing machine-directory
adapter. There is no shell, plugin registry, interpreter, runtime host-call
dispatcher, or implicit filesystem selection.

## C public routes and platform selection

| Public import | Node/default condition | `browser` condition |
| --- | --- | --- |
| `poe-code/safe-fs` | Existing full Node API, including host adapters and configuration | Portable core |
| `poe-code/safe-fs/core` | Portable surface with Node platform policy | Portable core, same implementation as browser root |
| `poe-code/safe-fs/node` | Full Node host API, same implementation as Node root | Runtime denied; empty declarations |
| `poe-code/safejs` | Existing Node SDK, unchanged | Runtime denied; empty declarations |
| `poe-code/safejs/core` | Existing Node core, unchanged | Runtime denied; empty declarations |
| `poe-code/safejs/cli` | Existing Node CLI entry, unchanged | Runtime denied; empty declarations |

Denial is limited to these named routes: it is not a wildcard removal of other
poe-code exports. An unsupported SDK/browser-FS mixture must fail import
resolution rather than appear to provide interoperable runtimes. Empty browser
declarations expose no named API; the runtime export target is `null`.

The portable surface includes contracts, errors, byte helpers, virtual path
normalization/resolution, memory, readonly, mount, overlay, WebDAV, `compareEntries`,
and `createFsBridge`. It does **not** include `RealFileSystem`, S3 and its
transports, `createNodeFsBridge`, Node POSIX path helpers, or the Node configuration
registry/helpers. `/core` selects a surface, not a forced browser policy:
ordinary Node resolution retains numeric errno and Node comparison authority.
The explicit `/node` route preserves the full Node API, not just the bridge.

Build the browser graph with the `browser` export condition and browser platform.
For TypeScript's `NodeNext` or `Bundler` resolution, select the matching
`customConditions: ["browser"]` and DOM libraries; Node consumers keep their
normal Node conditions/types. C routes the public declarations and the private
`#safe-fs-platform` type import to the matching profile. No consumer source aliases
or private workspace imports are required. Conditional exports cannot redirect
hard-relative imports inside existing Node SDK declarations; those SDK graphs
remain Node-only and are denied above, not certified by changing one export key.

Within **one installed poe-code module graph, realm and selected condition**,
Node root/core/node share one `FsError` constructor and authority registries;
the existing Node SafeJS entries use that same implementation. Browser root/core
likewise share one portable implementation. Node and browser profiles may be
separate graphs, but independently bundling copies into one application, mixing
conditions, duplicate installations, or crossing realms does not preserve identity.
The package has no mutable global platform-policy setter.

Safe-fs itself has zero external runtime package dependencies. Distribution via
poe-code still entails the root package's installation dependencies; it is not a
zero-dependency installation or a separate npm-scope publication. C adds no
browser codec dependency and does not polyfill Node globals.

## Node exports

The public Node imports are `poe-code/safe-fs` and `poe-code/safe-fs/node`.
They retain the following API:

- `FileSystemConfig`, `FileSystemAdapterDescriptor`, `FileSystemAdapterRegistry`,
  `readConfigRecord`, `validateFileSystemConfig`, `createFileSystem`,
  `createNodeFileSystemAdapterRegistry`, `createMemoryFileSystemAdapter`, and
  `createRealFileSystemAdapter` for explicit Node adapter configuration.

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
These private routes do not imply matching public routes. Only the public root,
`/core` and `/node` listed above are exposed; public `/node` is the full host API,
not the private bridge-only development entry. Within the workspace, the entries
reuse canonical modules; constructors and authority registries
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

## Explicit Node configuration

This configuration API and the SDK/CLI configuration below remain Node-only in C.
Browser core requires explicit adapter construction; it does not expose the Node
registry or interpret CLI configuration.

`createFileSystem({ type, options? }, { registry })` validates a descriptor's
options before constructing its adapter. The required registry is a caller-owned
`ReadonlyMap` of names to `{ validateOptions, create }` descriptors; validation is
synchronous and must not perform I/O. `createNodeFileSystemAdapterRegistry(extensions?)`
provides `memory` (empty options) and `real` (`{ root: "/absolute/host/directory" }`)
and adds explicit descriptors, rejecting duplicate built-in names. Other exported
backends remain directly constructible; they are not implicit JSON adapters.
Configuration rejects unknown fields and accessors. It loads no credentials,
executable modules or environment variables implicitly.

SafeJS exports `parseFsConfig` and `resolveFsConfig` from `poe-code/safejs`.
Both CLIs accept this JSON through `--fs-config <path>`:

```json
{ "adapter": { "type": "memory", "options": {} }, "root": "/work", "cwd": "/work/src" }
```

The outer `root` is optional absolute virtual confinement; `cwd` is an optional
absolute virtual relative-path base. Neither changes a real adapter's host root.
Omission preserves rooted defaults rather than injecting a path. Config-file
paths resolve against invocation cwd. `--fs-config` cannot repeat or combine with
`--fs`/`--fs-root`. SDK callers may pass a borrowed `AbortSignal` directly to
`makeFsModule`; signals are not JSON configuration. These APIs do not provide an
OS sandbox or browser access to host directories.

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

### Error and comparison policy

`FsError.code` is the authoritative symbolic error code. The one canonical class
has an `errno` property in both profiles: its exported `PlatformErrno` type is
`number` under Node and `number | undefined` under browser conditions, where the
value is `undefined`. Node preserves native numeric errno mappings; consumers
must not infer a portable numeric value. `isFsError` recognizes the canonical
constructor, optionally checking its code. Bridge argument errors and cancellation
errors are not all `FsError`; the Node bridge contract below still applies.

The portable `compareEntries` negotiates built-in entry identity through the same
private registries as the wrappers. Known identity can be used without a callback;
unknown identity is not upgraded to `same` or `distinct`. Node retains its
async-local custom comparison authority. Browser policy rejects a needed custom
`compareEntry` authority with `ENOTSUP` **before invoking it**; supplying WebDAV's
custom comparison option is rejected at construction and excluded by its browser
type. A replacement method is not silently trusted as a built-in authority.
This is a backend capability difference, not a reduced shell or SafeJS language.

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

### S3 filesystem and injected transports (Node only)

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
| `compareEntry` | Optional trusted backing-identity resolver on Node; unavailable under browser policy |

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

In browsers, an injected Fetch implementation is still required. Server CORS
policy must permit the methods and headers and expose required response headers;
browser restrictions on credentials, forbidden headers, redirects, and streaming
uploads still apply. A mock or loopback proof does not certify a deployed WebDAV
server. S3 browser transport, origin-private storage and directory-handle adapters
are not part of C.

## Portable byte bridge

`createFsBridge(filesystem, { codec, cwd?, signal? })` is exported by portable core.
It shares the Node bridge's 21-operation implementation, but uses owned
`Uint8Array` binary results rather than Buffer and accepts virtual string paths,
not Node Buffer/file-URL path conversion. Its public types are `FsBridge`,
`FsBridgeCodec`, `FsBridgeOptions`, `FsBridgeFileSystem`, `FsBridgeEncoding`,
`FsBridgeDirent`, and `FsBridgeStats`.

| Field | Meaning/default |
| --- | --- |
| `codec` | Required trusted object with `isEncoding(name)`, `encode(text, name)` and `decode(bytes, name)`; no default codec |
| `cwd` | Absolute virtual path, default `/`; no NUL, not a host working directory |
| `signal` | Optional borrowed cancellation signal, composed with operation signals; never aborted by the bridge |

There is no bridge `root` option. `cwd` resolves relative paths; it does not
confine absolute paths or parent traversal. Adapter scope and runtime confinement
are separate. The Node bridge's operation and option restrictions below also
apply to this bridge. The codec decides which encodings are supported; unsupported
requested encodings reject before adapter I/O. Filename conversion also needs
UTF-8 support. `isEncoding` returns a boolean, `encode` returns bytes, and `decode`
returns a string. The `FsBridgeEncoding` type admits `ascii`, `utf8`, `utf-8`,
`utf16le`, `utf-16le`, `ucs2`, `ucs-2`, `base64`, `base64url`, `latin1`, `binary`,
and `hex`; a codec need not implement them all. The supplied codec is trusted
host code: a codec that misreports support or throws during conversion is not a
rollback guarantee.

For example, a deliberately UTF-8-only codec needs no dependency:

```ts
import {
  MemoryFileSystem,
  createFsBridge,
  type FsBridgeCodec,
} from "poe-code/safe-fs/core";

const codec: FsBridgeCodec = {
  isEncoding: encoding => encoding === "utf8" || encoding === "utf-8",
  encode: text => new TextEncoder().encode(text),
  decode: bytes => new TextDecoder().decode(new Uint8Array(bytes)),
};
const memory = new MemoryFileSystem();
await memory.mkdir("/work");
const bridge = createFsBridge(memory, { codec, cwd: "/work" });
await bridge.writeFile("note", "hello", "utf8");
const text = await bridge.readFile("note", "utf8");
const bytes = await bridge.readFile("note");
```

Use browser Web APIs appropriate to the selected adapters: cancellation, URL,
byte/stream primitives and injected Fetch for WebDAV. The example's
`TextEncoder`/`TextDecoder` are an explicit host codec, not package-installed globals.
The portable bridge is not a SafeJS guest facade or a shell adapter.

### Secure entropy

Browser overlay staging and portable bridge `mkdtemp` require secure entropy:
`globalThis.crypto.randomUUID`, or UUID generation from `crypto.getRandomValues`.
If neither exists, the operation fails with `FsError` code `ENOTSUP`; there is no
`Math.random` fallback. `mkdtemp` needs entropy before creating a directory;
overlay can already have read/probed its backing layers before refusing staged
publication. Cancellation and entropy refusal do not imply rollback of arbitrary
host effects. Node keeps its native crypto policy and the existing Node bridge's
temporary-name generation.

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

The original safe-bash source repository declares Node >=22. This extraction emits
ES2022 ESM and does not change the root workspace's Node >=18.18 declaration.
Focused tests run on Node 18.18.2, 20.20.0, 22.22.2, and 24.14.0. Cancellation
composition does not require `AbortSignal.any`: the internal operation-scoped helper uses standard
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

C's filesystem-only proof checks actual emitted declarations through installed
public imports under strict NodeNext/Bundler and Node/browser conditions, without
source aliases. Its browser ESM bundle has no Node externals or Node globals and
passes the recorded Chromium runtime checks. This is stronger than the earlier
cancellation-helper/source-alias evidence, but does not certify the SafeJS engine,
safe-bash shell, native-disk access in a browser, or deployed-provider behavior.
WebDAV streaming uploads retain `duplex: "half"` through a local request-type
intersection; global DOM `RequestInit` is not augmented. Full browser SDK work
still needs owned execution/host-call metadata and a portable guest facade.

The bridge retains its legacy `Dirent.path` property alongside `parentPath`; a
type-only assertion accommodates the workspace's newer Node declarations without
removing that runtime property. Both the Node-only source check and the mixed
DOM/Node source-alias check validate the streaming request adaptation.

## Verified Node foundation release

`poe-code@12.0.3` was published on August 30, 2026 from commit
`1fede06f0956d5133b3e94eb4508f3e710c7d156` by successful GitHub release run
[`33294235871`](https://github.com/poe-platform/poe-code/actions/runs/33294235871).
Registry `gitHead`, tarball integrity and provenance match that commit and run.

Fresh installed-package runtime, shared filesystem authority/error identity,
real temporary-directory integration, strict NodeNext and Bundler TypeScript,
and CLI checks passed on Node 18.18.2, 22.22.2 and 24.14.0. The release ships
one canonical filesystem runtime and 35 foundation declaration files; their
bytes match the verified candidate. The 17/23 byte-identical adapter count and
six transformations below describe this released foundation, not later browser
portability work.

In A, private workspace/deep imports and the then-unsupported SafeJS `adapter`
option were rejected by public type checks. A's unshimmed browser root encountered
11 Node built-ins; helper checks did not certify that root. B subsequently shipped
the explicit Node integration described above. C's portable root/core and precise
Node-only route denials supersede the browser boundary, not A's historical result.
The complete cross-runtime/browser goal is not released.

## Provenance and validation

`PROVENANCE.json` records source/destination paths and SHA-256 hashes from source
HEAD `697ad092de111642aa376f74560da9927a0c9512`, with 31 upstream provenance
records across the initial 51-file foundation. In A, of the 23 extracted `src/fs/**/*.ts`
files, 17 were byte-identical and six were transformed: mount, overlay, native
disk, S3 filesystem, S3 HTTP transport, and WebDAV. The transformations include
cancellation lifetime, cleanup error precedence, and lint corrections; WebDAV
also has the local DOM-compatible streaming-request type. Mount comparison/identity
registries, private S3 authority, WebDAV resource-id bindings, and native identity
symbols were preserved in that foundation. These historical byte counts do not
describe C. Current provenance separately records platform policy, portable path
and bridge additions, transformations and tests. C retains one error class and
private authority registries per graph while selecting immutable platform policy;
the filesystem contract and persisted storage protocol strings remain preserved.

Only filesystem-neutral byte-source helpers are selected from `contracts/io.ts`.
The extracted Node bridge drops `makeSafeJsFsModule`, renames the structural type to
`NodeFsImplementation`, adjusts imports, removes an unused string validator, and
adds the type-only Dirent assertion. Existing metadata names, native identity
symbol and overlay staging prefix deliberately retain their original names.
Both bridge profiles now use the shared operation implementation and dispose
composed per-call signals. `src/contracts/abort.ts` and
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

The canonical consumer route is **`poe-code/safe-fs`**, with C's `/core` and `/node`
facades sharing identity within the corresponding installed graph and condition.
B migrated the Node SafeJS SDK/CLI integration; safe-bash migration remains separate.
The private workspace name is transitional, not a separate
npm bootstrap requirement. No sibling `file:` dependency, second bundled identity,
private registry bypass, or local publication is introduced here. Root packaging
and installed-artifact verification are complete for A's Node foundation and B's
Node integration. C has isolated packed filesystem/browser proof; its exact full
candidate and published-artifact verification must still precede a C release claim.
Old copies must remain until consumer integration is verified, then be removed;
while those copies remain this is not a completed deduplication. Validate real
providers and additional host profiles before claiming support beyond the
verified profiles. No whole-browser-runtime support follows from the FS-only C milestone.
