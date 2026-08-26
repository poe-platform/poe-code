# WebDAV filesystem adapter

`index.ts` exports `WebDavFileSystem`, `WebDavFileSystemOptions`, and the
`WebDavFetch` transport type. The class implements the established foundation
`FileSystem` interface. This leaf implementation does not add package exports,
root re-exports, manifests, dependencies, or plugin registration.

## Configuration and transport boundary

Required options are `baseUrl` and `fetch`. The transport signature is
`(url: string, init: RequestInit) => Promise<Response>`; passing Node's `fetch`
explicitly enables real HTTP. Constructing an adapter makes no requests. There
is no global-fetch fallback, environment credential discovery, credential-file
access, cookie jar, authentication negotiation, or automatic retry.

Optional `headers` are copied at construction. Explicit `Authorization` and
`Cookie` headers require HTTPS. HTTP without those headers is allowed for an
explicitly configured local server. URL userinfo, queries (even empty queries),
fragments, and protocol-control header overrides are rejected. Every request
sets `credentials: "omit"`, `redirect: "manual"`, and `Cache-Control: no-cache`.
Explicit collection suffixes are preserved in depth-zero metadata requests;
`stat("/collection/")` addresses `/collection/` directly. For a path without the
slash, only `PROPFIND` may perform one manual canonicalization after HTTP 301,
302, 307, or 308. The Location must be an absolute path or absolute HTTP(S) URL
that passes the same origin/root confinement checks and equals the exact
requested URL plus one trailing slash. No host, scheme, path-component, query,
fragment, userinfo, or alternative percent-encoding changes are allowed. The
second request retains the method, body, credential policy, and original abort
deadline; the first response body is cancelled. There is no redirect chain.
Other redirects, including all mutation redirects and HTTP 303, are rejected.
Unsafe redirect targets may report `EACCES`; other rejected redirects report
`ENOTSUP`. This narrow canonicalization is not general redirect following.

The injected transport is trusted code: it must honor the request URL, method,
headers, redirect/credential policy, and abort signal, and return a conforming
`Response`. An adapter cannot prevent a malicious transport from independently
performing I/O or adding credentials. A returned redirected response or changed
final URL is rejected, but such detection cannot undo I/O already performed by
a nonconforming transport. DNS, proxies, TLS trust, and server-side URL aliases
remain transport/server responsibilities, not a host-filesystem sandbox.

## Operations and semantics

- `stat`/`lstat`: depth-zero `PROPFIND`, named DAV properties only.
- `readdir`: depth-one `PROPFIND`, sorted direct children, no recursive crawl.
- `readFile`: metadata check followed by bounded binary `GET`.
- `writeFile`: binary `PUT`, including empty files; `wx` uses
  `If-None-Match: *` rather than an existence-check race.
- `mkdir`: `MKCOL`; recursive mode creates ancestors sequentially and handles
  a collection created concurrently by another client.
- `rm`: `DELETE`; recursive directory deletion is explicit. Root deletion is
  forbidden. `force` suppresses missing-resource errors, not partial failures.
- `rename`: server-side `MOVE`, including collection moves to absent targets.
- `copyFile`: server-side file `COPY` with `Depth: 0` to absent targets.
  Both transfers always send `Overwrite: F`, including nonexclusive copies,
  to prevent replacement if another client creates the destination after
  preflight. Such a race returns `EEXIST` and does not replace that resource.
  Existing destination replacement is unsupported; see the limit below.
- `realpath`: existence-checked lexical virtual path, not server alias discovery.
- `access`: existence (`F_OK`) only, not an inferred authorization result.

Paths are virtual POSIX-style paths relative to the configured collection;
relative paths resolve from `/`. Dot segments are normalized, but attempted
ascent above the virtual root, NUL, backslashes, and unpaired surrogates fail.
Each path component is percent-encoded separately. Literal percent sequences
in caller filenames remain literal names, not decoded URL instructions.
An explicit trailing slash or terminal `.`/`..` also requires the normalized
resource to be a collection. If the server reports a regular file, operations
fail with `ENOTDIR` before GET, PUT, DELETE, MOVE, or COPY. Missing slash-suffixed
write targets are not created as regular files. `force` does not suppress an
`ENOTDIR` result. Servers that treat a slash-suffixed file URL as nonexistent
may instead report `ENOENT`; the adapter still does not send a mutation.

Response hrefs must be absolute HTTP(S) URLs or absolute paths under the exact
configured origin and decoded collection-component prefix. Queries, fragments,
userinfo, dot segments, encoded separators, NUL, ambiguous empty segments,
duplicate resources, and members outside the requested depth fail closed.
Untrusted hrefs never initiate a separate network request.

No locking, ETag-based read/modify/write transaction, POSIX permission model,
or atomic multi-request transaction is advertised. `rename` and nonexclusive
`copyFile` return `ENOTSUP` for replacement of an existing destination file;
existing collection replacement is also unsupported. Exclusive copy returns
`EEXIST`. Type mismatches report `EISDIR` or `ENOTDIR` first, and identical-source
rename remains an existence-checked no-op. A preflight result cannot authorize
`Overwrite: T`: a different client could replace a file with a populated
collection before MOVE/COPY, causing recursive deletion. This adapter does not
implement destination locking or an equivalent verified state condition, so it
never sends that unsafe overwrite header. No unlink-then-transfer workaround
is used. This limits destination replacement, not reads, ordinary PUT writes,
creation, or transfers to absent destinations.

PUT preflights each parent collection, rejecting known file ancestors with
`ENOTDIR` before mutation. These metadata checks require PROPFIND access to the
parents; they do not lock the tree or prevent concurrent ancestor replacement.
Normal PUT writes and source type checks still have the server's WebDAV
semantics, not POSIX guarantees against every concurrent source replacement.
`atomicRename` is false because collection MOVE can fail partially.

Append (`a`, `ax`, `appendFile`), truncate, symlinks, hardlinks, chmod, utimes,
explicit creation modes, permission checks, and nonrecursive directory removal
return `ENOTSUP`. In particular, nonrecursive directory removal is not emulated
by an empty check followed by recursive DELETE. Streaming methods are absent
and both streaming capability flags are false. These are explicit backend
limitations, not claims of full POSIX or full WebDAV compliance.

## Metadata, XML, errors, and bounds

`DAV:resourcetype` is required; files additionally require a valid, safe-integer
`DAV:getcontentlength`. Missing required properties produce `ENOTSUP` rather
than invented file types/sizes. Successful property statuses are distinguished
from failed property statuses by expanded XML namespace names, not prefixes.

The mandatory `FileStat` fields unavailable in portable DAV are explicit
placeholders: mode is `0o100666` for files or `0o40777` for collections,
`atimeMs` and `ctimeMs` are zero, and an unavailable `mtimeMs` is zero. These
modes do not authorize access; `permissions` and `timestamps` capabilities are
false. Available last-modified and creation dates populate `mtimeMs` and
`birthtimeMs`; directory size is zero. Unknown extended resource types fail
with `ENOTSUP`.

The dependency-free XML scanner handles nested elements, namespace scopes and
rebinding, default namespaces, expanded attribute uniqueness, UTF-8/UTF-16,
predefined and numeric entities, Unicode names, comments, and CDATA. DTDs,
external/custom entities, malformed markup, undeclared prefixes, unsupported
XML versions/encoding declarations, and ambiguous duplicate DAV fields are
rejected. XML structure is tokenized, not extracted using regular expressions.
Small regular expressions validate lexical tokens and the XML declaration.

Default response limits, configurable through constructor options:

| Option | Default |
| --- | --- |
| `maxResponseBytes` | 64 MiB per file GET |
| `maxXmlBytes` | 2 MiB per multistatus |
| `maxEntries` | 10,000 responses, including the requested resource |
| `timeoutMs` | 30,000 per HTTP request, including body consumption |

`readFile.maxBytes` may lower the file-read limit, including to zero. Actual
stream bytes are counted even without Content-Length, and excess/aborted bodies
are cancelled. XML also has fixed ceilings of 64 nested elements, 100,000 nodes,
10,000 total attributes, 128 attributes per element, and 256 namespace
declarations. A conforming transport must honor abort for request timeouts;
the adapter separately cancels pending body reads when aborted.

RFC 4918 depth-one PROPFIND has no standard pagination cursor. This adapter
expects a complete multistatus, rejects excessive results instead of truncating,
and rejects an advertised HTTP `Link` with `rel=next` as `ENOTSUP`. It does not
implement vendor pagination or infer completeness from unknown extensions; a
server that silently truncates without a recognized signal cannot be detected.

HTTP failures map to foundation `FsError` codes: authentication/authorization
to `EACCES`, missing resources to `ENOENT`, locks to `EBUSY`, quota to `ENOSPC`,
exclusive conflicts to `EEXIST`, unsupported methods to `ENOTSUP`, and transport
or malformed responses to `EIO`. Caller cancellation is `ECANCELED`; deadlines
are `ETIMEDOUT`. Unexpected success statuses are not silently accepted.
Mutation multistatus failures report `EIO` with the individual mapped `FsError`
as `cause`. Earlier server-side changes may already have happened; there is no
rollback. A mutation multistatus without a reported failure is also rejected
rather than guessing that the operation completed.

## Verification

Run from the repository root:

```sh
node --import tsx --test 'tests/fs/webdav/*.test.ts'
npm run typecheck
node_modules/.bin/tsc -p tsconfig.build.json --noEmit
```

Focused source-and-test checking, without compiling concurrent workers' code:

```sh
node_modules/.bin/tsc --noEmit --target ES2023 --lib ES2023 \
  --module NodeNext --moduleResolution NodeNext --strict \
  --noUncheckedIndexedAccess --exactOptionalPropertyTypes \
  --verbatimModuleSyntax --forceConsistentCasingInFileNames --skipLibCheck \
  --types node src/fs/webdav/index.ts tests/fs/webdav/*.ts
```

Tests include an injected mock HTTP transport, binary and empty data, namespace
and entity attacks, path/href confinement, explicit authentication, redirects,
partial failures, cancellation, limits, concurrency races, a 200-file stress
cycle, and real Node fetch against ephemeral loopback HTTP servers. They do not
contact public WebDAV servers or prove interoperability with every deployment.
Review regressions include regular-file preservation for collection suffixes,
slash-canonicalizing real HTTP servers, hostile redirect locations, stale
destination-file metadata followed by a populated collection, and conditional
rejection of a destination collection created after absent-target preflight.

## Coordinator integration (not applied by this leaf)

Curie owns the package manifest and root export integration. The exact package
`exports` entry required for `virtual-bash/fs/webdav` is:

```json
"./fs/webdav": {
  "types": "./dist/fs/webdav/index.d.ts",
  "import": "./dist/fs/webdav/index.js"
}
```

If the coordinator also exposes these names from the package root, add
`export * from "./fs/webdav/index.js";` to `src/index.ts`. The subpath entry
alone is sufficient for subpath imports; no runtime dependency, installation,
contract change, or additional exported parser API is required.

## Primary references read

- RFC 4918, HTTP Extensions for Web Distributed Authoring and Versioning:
  sections 8.3, 9.1, 9.3, 9.6–9.9, 10.2–10.3, 10.6, 13, 14, and 20.6.
  `https://www.rfc-editor.org/rfc/rfc4918.html`
- W3C Namespaces in XML 1.0 (Third Edition), qualified names, namespace
  declarations/scoping, and expanded-attribute uniqueness.
  `https://www.w3.org/TR/xml-names/`
- W3C Extensible Markup Language (XML) 1.0 (Fifth Edition), character/name
  productions, comments, processing instructions, CDATA, and XML declarations.
  `https://www.w3.org/TR/xml/`
