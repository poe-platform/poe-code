# safe-fs

An asynchronous filesystem interface for memory, rooted host directories, S3, and WebDAV, with mounts, copy-on-write overlays, and Node-style bridges.

## Quickstart

Import from `poe-code/safe-fs`; it is included in `poe-code`, with no separate package needed. These examples use TypeScript in a Node ESM application.

```ts
import { createMemoryFileSystem, createNodeFsBridge } from "poe-code/safe-fs";

const storage = createMemoryFileSystem();
await storage.mkdir("/work");
await storage.writeFile("/work/note.txt", new TextEncoder().encode("hello"));
console.log(new TextDecoder().decode(await storage.readFile("/work/note.txt")));

const fs = createNodeFsBridge(storage, { cwd: "/work" });
await fs.appendFile("note.txt", " world", "utf8");
console.log(await fs.readFile("note.txt", "utf8"));
```

Output: `hello`, then `hello world`. Nothing touches the host filesystem. Raw adapters exchange `Uint8Array` values; the Node bridge adds strings, encodings, `Buffer` results, and stat predicates. Its `cwd` is both the relative-path base and the confinement boundary.

For host storage, use `await createRealFileSystem({ root: "/absolute/existing/directory" })` instead. The root must already exist; virtual `/` maps to that directory. Read the safety boundary below before exposing it to untrusted code.

## Supported operations

| Operation | Interface |
| --- | --- |
| Read and write bytes | `readFile`, `writeFile`, `appendFile` |
| Inspect entries | `stat`, `lstat`, `readdir`, `realpath`, `access` |
| Change the namespace | `mkdir`, `rm`, `rename`, `copyFile` |
| Remove an empty directory | Optional `rmdir`; never a recursive-delete fallback |
| Links and metadata | Optional `readlink`, `symlink`, `link`, `chmod`, `utimes`, `truncate` |
| Stream bytes | Optional `readStream`, `writeStream`, using async iterables of byte chunks |
| Compare backing entries | Optional `compareEntry`, returning `same`, `distinct`, or `unknown` |

All required methods must exist, but a backend may reject an operation with `FsError`, such as `EROFS` for a write or `ENOTSUP` for unsupported semantics. Check optional methods and `capabilities` rather than assuming every backend behaves like a local disk. Errors expose `code` and may include `syscall`, `path`, `dest`, and `cause`.

| Backend or wrapper | Use it for |
| --- | --- |
| `createMemoryFileSystem()` | Isolated, nonpersistent storage with links, permissions, timestamps, and streams |
| `createRealFileSystem({ root })` | An existing host directory, with virtual paths rooted inside it; Node only |
| `new S3FileSystem({ transport, bucket, … })` | Bucket/prefix storage through an explicitly supplied transport; Node only |
| `new WebDavFileSystem({ baseUrl, fetch, … })` | A WebDAV namespace through an explicitly supplied Fetch implementation |
| `createReadOnlyFileSystem(filesystem)` | Rejecting writes through one view of an existing filesystem |
| `createMountFileSystem({ root, mounts })` | Routing absolute virtual mount paths to different filesystems |
| `createOverlayFileSystem({ upper, lower })` | Reading through to a lower layer and writing changes to an upper layer |

`createNodeFsBridge` offers a promises-shaped subset, including recursive `cp` and `mkdtemp`. The portable `createFsBridge` from `poe-code/safe-fs/core` instead requires a caller-supplied text codec and returns `Uint8Array` values.

## Write an adapter

A backend implements the exported [`FileSystem` interface](src/contracts/filesystem.ts). It needs every non-optional method, a truthful `capabilities` object, byte-safe reads/writes, and appropriate errors. A configuration adapter adds `validateOptions` and a `create` factory returning that filesystem, synchronously or asynchronously.

This hypothetical `catalog` adapter presents a snapshot of named text documents as read-only files at `/`. It implements the full required interface without a host filesystem or network connection. Only the root directory and single-component filenames are supported; timestamps are synthetic and optional operations are absent.

```ts
import {
  ACCESS_MODES, FsError, createFileSystem,
  createNodeFileSystemAdapterRegistry, readConfigRecord, validatePath,
  type FileStat, type FileSystem, type FileSystemAdapterDescriptor,
  type FsOptions,
} from "poe-code/safe-fs";

const catalogAdapter = {
  validateOptions(options) {
    const config = readConfigRecord(options, "catalog option", ["files"]);
    const files = readConfigRecord(config.files, "catalog files");
    for (const [name, text] of Object.entries(files)) {
      if (!name || name === "." || name === ".." || name.includes("/")
        || name.includes("\0") || typeof text !== "string") {
        throw new TypeError("files must map single-component names to strings");
      }
    }
  },
  create(options): FileSystem {
    const files = new Map(Object.entries(readConfigRecord(options.files, "catalog files"))
      .map(([name, text]) => [name, new TextEncoder().encode(text as string)]));

    function lookup(path: string, options?: FsOptions) {
      if (options?.signal?.aborted) throw new FsError("ECANCELED", { path });
      validatePath(path);
      let name = "";
      let bytes: Uint8Array | undefined;
      for (const part of path.split("/")) {
        if (bytes !== undefined) throw new FsError("ENOTDIR", { path });
        if (part === "" || part === "." || part === "..") continue;
        bytes = files.get(part);
        if (bytes === undefined) throw new FsError("ENOENT", { path });
        name = part;
      }
      return { path: `/${name}`, bytes };
    }

    async function inspect(path: string, options?: FsOptions): Promise<FileStat> {
      const { bytes } = lookup(path, options);
      return {
        type: bytes === undefined ? "directory" : "file",
        size: bytes?.byteLength ?? 0,
        mode: bytes === undefined ? 0o40555 : 0o100444,
        atimeMs: 0, mtimeMs: 0, ctimeMs: 0,
      };
    }

    async function denyWrite(): Promise<never> {
      throw new FsError("EROFS");
    }

    return {
      capabilities: { readOnly: true },
      async readFile(path, options) {
        const { bytes } = lookup(path, options);
        if (bytes === undefined) throw new FsError("EISDIR", { path });
        const limit = options?.maxBytes ?? Number.MAX_SAFE_INTEGER;
        if (!Number.isSafeInteger(limit) || limit < 0) throw new FsError("EINVAL", { path });
        if (bytes.byteLength > limit) throw new FsError("EFBIG", { path });
        return bytes.slice();
      },
      stat: inspect,
      lstat: inspect,
      async readdir(path, options) {
        if (lookup(path, options).bytes !== undefined) throw new FsError("ENOTDIR", { path });
        return [...files.keys()].sort().map(name => ({ name, type: "file" as const }));
      },
      async realpath(path, options) {
        const entry = lookup(path, options);
        return entry.path;
      },
      async access(path, mode = ACCESS_MODES.F_OK, options) {
        const entry = lookup(path, options);
        if (!Number.isInteger(mode) || mode < 0 || mode > 7) throw new FsError("EINVAL", { path });
        if (mode & ACCESS_MODES.W_OK) throw new FsError("EROFS", { path });
        if ((mode & ACCESS_MODES.X_OK) && entry.bytes !== undefined) {
          throw new FsError("EACCES", { path });
        }
      },
      writeFile: denyWrite, appendFile: denyWrite, mkdir: denyWrite,
      rm: denyWrite, rename: denyWrite, copyFile: denyWrite,
    };
  },
} satisfies FileSystemAdapterDescriptor;

const registry = createNodeFileSystemAdapterRegistry(new Map([["catalog", catalogAdapter]]));
const catalog = await createFileSystem({
  type: "catalog",
  options: { files: { "welcome.txt": "Hello from the catalog" } },
}, { registry });

console.log(new TextDecoder().decode(await catalog.readFile("/welcome.txt")));
```

Output: `Hello from the catalog`. `readFile` returns a copy so callers cannot mutate the stored snapshot. Reads check cancellation and `maxBytes`; required mutations always reject with `EROFS`. `stat` and `lstat` share an implementation because this adapter has no symlinks.

`createFileSystem` validates options before calling the factory. The Node registry includes `memory` and `real`, accepts new names, and rejects attempts to replace those defaults. For an explicit allowlist without either default, pass `new Map([["catalog", catalogAdapter]])` directly as `registry`. Names select registered factories; they do not load modules from config.

For a mutable backend, preserve exclusive-create behavior, return independent byte buffers, handle cancellation and size limits, and declare only capabilities you actually provide. Use `FsError` for filesystem failures. Do not invent entry identity from matching paths or metadata; omit `compareEntry` when identity is unknown.

## Options

There are no package environment variables, implicit credentials, or automatic `.env` loading. Applications supply configuration, transports, and credentials explicitly. Factories accept the same options as their corresponding classes.

### Local storage, composition, and bridges

| API | Options and defaults |
| --- | --- |
| `createFileSystem(config, { registry })` | Required `config.type`; `config.options` defaults to an empty record. `registry` is required. Built-in `memory` accepts no options; built-in `real` requires `root`. |
| `createNodeFileSystemAdapterRegistry(extensions?)` | Optional map of additional adapter descriptors; defaults to only `memory` and `real`. |
| Memory / read-only | Memory takes no options. Read-only takes the backing filesystem, without an options object. |
| Real | Required `root`: existing absolute host directory; the constructor/factory also accepts the root string directly. |
| Mount | Required `root`: fallback filesystem. `mounts` defaults to `{}` and maps absolute virtual paths to filesystems. |
| Overlay | Required `upper` and `lower`; `maxBufferBytes` defaults to 64 MiB. |
| Node bridge | `cwd` defaults to `/`, must be an absolute virtual path; optional lifetime `signal`. |
| Portable bridge | Same `cwd` and `signal`, plus required `codec` with `isEncoding`, `encode`, and `decode` functions. |
| Catalog example | Required `files`: a plain record of single-component filenames to text strings; no other options. |

### Per-operation options

Every raw filesystem operation accepts an optional `signal`. Additional fields are:

| Operation | Options |
| --- | --- |
| `readFile` | `maxBytes`: upper bound on collected bytes |
| `writeFile`, `writeStream` | `flag`: `w` (default, replace), `wx` (exclusive create), `a` (append), or `ax` (exclusive append/create); optional `mode` |
| `appendFile` | Optional `mode` |
| `mkdir` | `recursive` (default false); optional `mode` |
| `rm` | `recursive` and `force` (default false) |
| `copyFile` | `exclusive` (default false) |
| `readStream` | `start` (default 0), `endExclusive` (default end of file), `chunkSize` (built-in default 64 KiB) |

`access` takes a separate mode bitmask from `ACCESS_MODES`. `chmod` takes a mode, `utimes` takes millisecond timestamps, and `truncate` takes a byte length (default 0). Backend limits still apply. Node-shaped bridge methods translate their own options rather than accepting these raw option objects; see the [bridge signatures](src/bridge/filesystem.ts).

<details>
<summary>S3 filesystem and HTTP transport options</summary>

`S3FileSystem` requires `transport` and `bucket`. A transport supplies `headObject`, `getObject`, `putObject`, `deleteObject`, `copyObject`, and `listObjectsV2`; see the [transport interface](src/fs/s3/transport.ts).

`createS3Transport(client, capabilities?)` wraps a compatible client with explicit `streamingRead`, `streamingWrite`, `conditionalPut`, `conditionalCopy`, and `conditionalDelete` flags (all absent by default). Direct transport requests accept an optional `abortSignal`.

For in-memory S3 simulations, `new MockS3Client({ buckets, pageSize?, now?, authorize? })` requires bucket names. `pageSize` defaults to 1,000 (range 1–1,000), `now` defaults to the current date/time, and optional `authorize(request)` can reject requests. It does not verify a real provider.

| Optional field | Default / meaning |
| --- | --- |
| `prefix` | Empty; canonical relative object-key prefix |
| `readOnly` | `false` |
| `allowNonAtomicRename` | `true`; rename copies then deletes, without rollback guarantees |
| `pageSize` | 1,000; range 1–1,000 |
| `maxReadBytes` | 64 MiB |
| `maxStreamBytes` | 5,000,000,000 bytes; also the maximum accepted value |
| `maxListEntries` | 100,000 |
| `compareEntry` | Optional trusted backing-identity callback |

`createS3HttpTransport` requires `endpoint` (an origin without path or credentials), `region`, and `credentials`. Credentials contain `accessKeyId`, `secretAccessKey`, and optional `sessionToken`, or come from an async provider receiving `{ signal }`.

| Optional field | Default / meaning |
| --- | --- |
| `addressingStyle` | `path`; alternative `virtual-hosted` requires a DNS endpoint |
| `listUrlEncoding` | `percent`; alternative `form` |
| `allowInsecureHttp` | `false`; HTTPS required unless explicitly enabled |
| `maxPutBytes`, `maxGetBytes` | 64 MiB each |
| `maxXmlBytes` | 4 MiB; maximum 16 MiB |
| `requestTimeoutMs` | 30,000 |
| `enableCopy` | `true`; disabling uses a buffered GET/PUT fallback |
| `verifiedConditionalOperations` | Optional `put`, `copy`, `delete` booleans, each defaulting to false; enable only after verifying the server's semantics |
| `clock` | Current date/time function, used for signing |
| `request` | Optional Node HTTP request factory; defaults to the built-in HTTP(S) client |

</details>

<details>
<summary>WebDAV options</summary>

`WebDavFileSystem` requires `baseUrl` and `fetch`.

| Optional field | Default / meaning |
| --- | --- |
| `headers` | Empty; explicit authentication/custom headers. Protocol-reserved headers are rejected; authorization and cookies require HTTPS. |
| `requestStreamSupport` | `native` for global Fetch, otherwise false; accepts `native` or a boolean declaration for the injected transport |
| `maxResponseBytes` | 64 MiB |
| `maxXmlBytes` | 2 MiB |
| `maxEntries` | 10,000 |
| `timeoutMs` | 30,000 |
| `overwritePolicy` | `lock`; alternative `etag` uses conditional overwrites |
| `atomicEmptyDirectory` | Optional trusted binding with the canonical `namespaceUrl` and `removeEmptyDirectory` callback; required for strict empty-only `rmdir` |
| `compareEntry` | Optional trusted backing-identity callback on Node; unavailable under browser policy |

See the [binding types](src/fs/webdav/webdav.ts) before implementing atomic directory removal. A recursive WebDAV DELETE does not satisfy that contract.

</details>

## Safety boundary and limitations

- **Not an OS sandbox.** Rooted storage and bridge confinement check paths and symlinks, but checks and host operations can race concurrent changes. Use a separate OS isolation boundary for hostile workloads. A custom adapter or transport is trusted code with its own host authority.
- **A read-only view is not an immutable store.** Other references can still change the backing filesystem. Overlays are not transactions; cancellation and cleanup do not guarantee rollback. Cross-mount rename can fail with `EXDEV`.
- **Remote storage is not a POSIX disk.** S3 and WebDAV do not provide hardlinks or symlinks. S3 rename is non-atomic and may leave partial copies/deletions; `S3RenameError` reports the phase and affected keys. Strong empty-only removal and conditional writes depend on backend support, not a prior listing.
- **The bridges are partial Node compatibility layers.** No synchronous/callback API, file handles, watchers, bigint stats, flush/retry support, or `cp` dereference/timestamp-preservation options. Missing optional operations fail rather than being approximated with destructive alternatives.
- **Browser support is filesystem-only.** The `browser` export condition selects the portable surface: memory, mounts, overlays, read-only, WebDAV, and the codec-based bridge. Real storage, S3, the Node bridge, and the configuration registry are not browser exports. WebDAV still needs server CORS support; no OPFS or directory-handle adapter is included. This does not make the SafeJS runtime browser-compatible.
- **Portable temporary names require secure randomness.** Browser overlay staging and portable bridge `mkdtemp` require `crypto.randomUUID` or `crypto.getRandomValues`; without either, they fail with `ENOTSUP` rather than use `Math.random`.
- **Allocation and identity may be unknown.** Optional `FileStat.allocatedBytes` is provider-reported allocation, not logical length or reclaimable space. Do not infer identity from size, timestamps, or inode numbers across unrelated backends.
