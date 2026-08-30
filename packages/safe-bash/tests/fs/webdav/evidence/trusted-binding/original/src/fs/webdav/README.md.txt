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

Pending fetch-response waits race the supplied caller signal and per-request
deadline. Even if an injected fetch ignores abort, the adapter stops awaiting
it and does not resume normal operations when it eventually settles. Late
rejections are observed; late unlocked response bodies receive a best-effort
`cancel(signal.reason)` without awaiting their cleanup. This bounds the outward
fetch wait, not the lifetime of ignored transport work, sockets or remote side
effects. Synchronous host work cannot be interrupted. The transport must still
honor abort to actually stop its own work; cancellation does not undo accepted
PUT/MOVE/COPY effects.

## Operations and semantics

- `stat`/`lstat`: depth-zero `PROPFIND`, named DAV properties only.
- `readdir`: depth-one `PROPFIND`, sorted direct children, no recursive crawl.
- `readFile`: metadata check followed by bounded binary `GET`.
- `readStream`: lazy, pull-based binary `GET`; start/endExclusive select byte
  offsets locally without relying on optional server Range support. Chunks are
  copied and capped by `chunkSize` (default 64 KiB). The response stays open only
  until EOF, the selected end, cancellation, deadline, or iterator return.
- `writeFile`: binary `PUT`, including empty files; `wx` uses
  `If-None-Match: *` rather than an existence-check race.
- `writeStream`: pull-driven PUT with copied producer chunks and native Fetch
  `duplex: "half"`. There is no whole-upload buffer or dependency on host files.
  The same preflight, exclusive-create, and conditional-append rules apply.
  Append buffers only the bounded existing representation before uploading it
  ahead of the new stream. Total uploaded bytes are capped by `maxResponseBytes`.
- `appendFile`/`a`: bounded read-modify-write using the identity GET's strong
  ETag in `If-Match` on PUT; missing targets use `If-None-Match: *`.
  Changed existing targets fail with `EAGAIN`; creation races fail with
  `EEXIST`. There are no automatic retries or lost-update fallback writes.
  `ax` exclusively creates via `If-None-Match: *`, like `wx`.
  Existing-file append requires a strong GET ETag and identity representation;
  missing/weak validators or encoded responses produce `ENOTSUP` before PUT.
  Combined append output is bounded by `maxResponseBytes`.
- `mkdir`: `MKCOL`; recursive mode creates ancestors sequentially and handles
  a collection created concurrently by another client.
- `rm`: `DELETE`; recursive directory deletion is explicit. Root deletion is
  forbidden. `force` suppresses missing-resource errors, not partial failures.
- `rename`: server-side `MOVE`, including collection moves to absent targets.
- `copyFile`: server-side file `COPY` with `Depth: 0` to absent targets.
  Transfers to absent targets use `Overwrite: F`; concurrent creation returns
  `EEXIST` without replacement. Existing files and empty destination collections
  can be replaced under the concurrency policy below; exclusive copies still
  return `EEXIST` for existing targets.
- `realpath`: existence-checked lexical virtual path, not server alias discovery.
- `utimes`: conditional PROPPATCH of a persistent timestamp dead property;
  see the provider requirements and timestamp semantics below.
- `access`: existence (`F_OK`), or actual read authorization (`R_OK`) via GET
  response headers for files and depth-one PROPFIND for directories. The GET
  body is cancelled, not collected. This is a point-in-time probe, not a
  guarantee that a later read succeeds. Write/execute permission probes remain
  unsupported; synthesized mode bits never authorize access.

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

### Replacement concurrency policy

`overwritePolicy` accepts `"lock"` (default) or `"etag"`. No root export wiring
is needed: it is a field of the existing `WebDavFileSystemOptions` interface.

The default acquires an exclusive depth-infinity destination write lock using
`LOCK`, validates the returned lock token, scope, type, root, depth and finite
timeout, then rechecks the destination type and collection emptiness while
locked. The transfer sends `Overwrite: T` with one destination-tagged `If`
condition containing that lock token. A lock expiry before the transfer fails
its precondition rather than authorizing overwrite. A strong preflight ETag,
when available, guards LOCK with `If-Match`; otherwise `If-Match: *` prevents
LOCK from creating a missing resource. Nonempty collections return `ENOTEMPTY`.
Type mismatches return `EISDIR`/`ENOTDIR`; moving onto an ancestor is rejected.

Locks request `Second-60`, but servers choose the actual finite timeout. There
is no refresh or automatic mutation retry. `UNLOCK` is attempted even after
cancellation or failed/partial transfer, with a fresh request deadline. Cleanup
failure does not mask the transfer result: a lock may remain until its granted
timeout. When a successful LOCK response is available at cancellation, its
syntactically valid token is retained for cleanup only after response-origin,
resource and redirect checks; no COPY/MOVE follows that cancellation. This
also covers cancellation while reading the lock body. A lost LOCK response,
an untrusted response URL or an unusable token can still leave a lock behind;
cleanup is best-effort, not cancellation atomicity. Infinite grants are
rejected with cleanup.
If a successful LOCK response arrives only after the outward fetch wait has
already been cancelled, the same response-origin/resource/redirect and token
checks gate a detached best-effort UNLOCK with a fresh deadline. Only cleanup
runs, never the transfer. The cancelled API call does not wait for this late
response or its cleanup. Cleanup fetch waits are also bounded if the injected
transport ignores their signals, but an unknown token, rejected/never-settling
fetch or failed UNLOCK can still leave a remote lock until expiry.
Servers without the required lock support return `ENOTSUP`; there is no silent
downgrade to an unprotected overwrite.

A failed depth-infinity LOCK can return HTTP 207. Its multistatus is parsed
within the XML byte and entry budgets; every member must remain in the requested
destination subtree. A concrete member failure takes precedence over a root
424 dependency failure: 423 maps to `EBUSY`, and 403 to `EACCES`. The outer error
retains the LOCK syscall and destination path, with the member path and HTTP
status in its `cause`. No transfer or token-based cleanup follows a failed
multistatus, even if it includes a Lock-Token header. Malformed or success-only
multistatus responses fail closed rather than authorizing a transfer.

Opting into `"etag"` permits replacement of existing **files** without locks,
using the destination's strong `DAV:getetag` in a single destination-tagged
`If` condition. This policy requires a provider that keeps destination tags
strong and distinct across content/type changes. RFC 4918 permits weak
comparison for `If`; switching to a weak validator with the same opaque value
can therefore defeat this opt-in protection. Use the default lock policy if
that provider guarantee is unavailable. Missing/weak destination tags return
`ENOTSUP`, not an unconditional overwrite. Collections always require locking
under either policy: collection ETags do not prove membership stability.

`If-Match` on MOVE/COPY guards the **source**, never the destination; the adapter
adds it when a strong source `DAV:getetag` is available. Destination conditions
are not combined with another resource-tag list (the lists have OR semantics).
No DELETE-then-transfer emulation is used. `atomicRename` remains false: source
trees and ancestors are not locked, and servers may partially apply collection
MOVE. Identical-source rename remains an existence-checked no-op.

Protocol basis: RFC 9110 sections 8.8.3 and 13.1.1–13.1.2; RFC 4918 sections
7.4–7.6, 8.5, 9.8.4, 9.9.3, 9.10–9.11, 10.4 and 10.6. Capability evidence is
the owned `append.test.ts` and `replacement.test.ts` suites: binary append,
creation/update races, destination-tag scope, lock conflicts/expiry, membership
races, cancellation cleanup, partial failure and native loopback HTTP. This
does not certify arbitrary production WebDAV providers or full POSIX behavior.

PUT preflights each parent collection, rejecting known file ancestors with
`ENOTDIR` before mutation. These metadata checks require PROPFIND access to the
parents; they do not lock the tree or prevent concurrent ancestor replacement.
When a target PROPFIND reports a missing resource, metadata lookup also probes
its normalized ancestors to distinguish `ENOTDIR` from `ENOENT`. This does not
change lexical dot-segment resolution or turn it into POSIX component walking.
Normal PUT writes and source type checks still have the server's WebDAV
semantics, not POSIX guarantees against every concurrent source replacement.
`atomicRename` is false because collection MOVE can fail partially.

Truncate, symlinks, hardlinks, chmod,
explicit creation modes, write/execute permission checks, and nonrecursive directory removal
return `ENOTSUP`. In particular, nonrecursive directory removal is not emulated
by an empty check followed by recursive DELETE. Both streaming capabilities
are true. These remaining gaps are explicit backend
limitations, not claims of full POSIX or full WebDAV compliance.

Additive `rmdir(path, options?)` distinguishes observed files (`ENOTDIR`), missing
paths (`ENOENT`), and nonempty collections (`ENOTEMPTY`). An observed-empty
collection returns `ENOTSUP`; the root returns `EBUSY`. Inspection is read-only:
no DELETE, LOCK, or other mutation is sent. Cancellation remains `ECANCELED`,
and typed inspection failures retain their code and underlying cause while
reporting the requested rmdir path. Existing `rm({ recursive: false })` behavior
is unchanged.

RFC 4918 section 9.6.1 requires collection DELETE to operate recursively, even
without a Depth header. Neither an empty PROPFIND result nor a collection ETag
establishes an atomic empty-collection deletion guarantee in this adapter.
No provider-specific guarantee is configured, so `rmdir` never follows an empty
listing with DELETE or invents a capability. A child created after the listing
is preserved. Listings are not snapshots, and existing non-atomic MOVE and
identity/overwrite caveats remain unchanged. Reference, consulted August 26, 2026:
`https://www.rfc-editor.org/rfc/rfc4918.html#section-9.6.1`.

## Persistent virtual timestamps

`utimes` sets the single dead property `{urn:virtual-bash:metadata}timestamps`
using PROPPATCH and `If-Match` with a strong `DAV:getetag`. Its version-1 JSON
value records `atimeMs`, `mtimeMs`, the resource type, and the ETag. Millisecond
values are finite and within the JavaScript Date range. `stat` and `lstat`
request this property explicitly and expose the stored values only when its
ETag and type still match. Missing properties fall back to ordinary DAV
metadata. Malformed successful properties fail with `EIO`, not guessed values.
Another adapter instance can read the same persisted values. No instance-local
timestamp map substitutes for a server mutation.

This is a virtual metadata extension, **not** an attempt to change the server's
protected `DAV:getlastmodified`, HTTP Last-Modified, or native filesystem atime.
Reads do not automatically advance atime. Providers must support arbitrary
dead properties, strong resource ETags, conditional PROPPATCH, and round-trip
the property in PROPFIND. `timestamps: true` advertises this implemented
extension, not successful negotiation with every provider. Unsupported methods,
permission denials, locks, storage exhaustion and stale versions retain their
real `ENOTSUP`, `EACCES`, `EBUSY`, `ENOSPC` and `EAGAIN` errors. There is no no-op
fallback, PUT rewrite, missing-file creation, or automatic retry in `utimes`.

The response must identify exactly the requested resource/property and report
property status 200; HTTP 207 alone is not success. A failed or lost response
cannot establish rollback of remote side effects. Dead-property persistence
through COPY/MOVE remains the server's responsibility. Content changes with a
different ETag invalidate old virtual timestamps; identical-byte rewrites,
delete/recreate with reused tags, and collection membership changes with stable
ETags are not distinguishable by this binding. A provider that changes ETags
when applying the property can make it immediately stale. These are explicit
limits, not POSIX timestamp or collection-version guarantees.

Protocol basis: RFC 4918 sections 4, 9.1, 9.2, 9.2.1, and 15.7; RFC 9110
section 13.1.1. RFC 4918 recommends support for arbitrary dead properties and
protecting `DAV:getlastmodified`; it does not mandate a portable native utimes
operation. The owned `property-fixture.ts` adds this protocol to a composed
local fixture without changing the shared MockDav or integration matrix.

## Metadata, XML, errors, and bounds

`DAV:resourcetype` is required; files additionally require a valid, safe-integer
`DAV:getcontentlength`. Missing required properties produce `ENOTSUP` rather
than invented file types/sizes. Successful property statuses are distinguished
from failed property statuses by expanded XML namespace names, not prefixes.

The mandatory `FileStat` fields unavailable in portable DAV are explicit
placeholders: mode is `0o100666` for files or `0o40777` for collections,
`ctimeMs` is zero, unset virtual atime is zero, and an unavailable `mtimeMs` is
zero. These modes do not authorize access; `permissions` remains false.
Absent matching virtual timestamps, available last-modified and creation dates populate `mtimeMs` and
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
| `maxResponseBytes` | 64 MiB per file GET or streamed upload |
| `maxXmlBytes` | 2 MiB per multistatus |
| `maxEntries` | 10,000 responses, including the requested resource |
| `timeoutMs` | 30,000 per HTTP request, including body consumption |

`readFile.maxBytes` may lower the file-read limit, including to zero.
`readStream` transfer bytes (including discarded range prefixes) also count
toward `maxResponseBytes`; streaming avoids whole-file buffering, not this bound.
The request deadline includes consumer backpressure pauses. Actual
stream bytes are counted even without Content-Length, and excess/aborted bodies
are cancelled. Identity bodies must exactly match a valid declared
Content-Length, including empty/null bodies; truncated, excessive or malformed
lengths fail with `EIO` (configured byte-limit overflow remains `EFBIG`). GET
requests prefer `Accept-Encoding: identity`. A server may still encode its
response: with native Fetch decompression the header describes encoded bytes,
not the decoded stream, so non-identity lengths are not compared or used as
decoded-size bounds. Transport decoding/framing integrity remains the trusted
transport's responsibility for encoded responses; actual delivered bytes are
always bounded. RFC 9110 sections 8.4 and 8.6 define the encoding/length basis.
The native-loopback regression records that Node Fetch can accept gzip with a
missing trailer while delivering the complete decoded payload; the adapter
cannot verify encoded trailers hidden by Fetch. Corrupt gzip headers that
Fetch rejects surface as `EIO`. Identity length checks do not claim to remedy
this encoded-transport limitation.

Uploads propagate cancellation and deadlines into producer waits, observe late
rejections, and request iterator cleanup without waiting forever on an
uncooperative producer. A transport success before upload EOF is rejected.
The injected transport must support streaming RequestInit bodies and honor
abort signals; arbitrary trusted transport code cannot be forcibly stopped.
Native Fetch and remote servers may have their own bounded read-ahead buffers.
Neither PUT streaming nor cancellation promises atomicity: a provider can have
received or committed partial bytes before an error. No retry or rollback is
invented. Caller-requested ranges and early reader return deliberately stop
before EOF and cannot verify the unconsumed tail's declared length.

Adapter XML node and total-attribute budgets scale with
`maxXmlBytes` (at most one node/attribute per permitted byte); they cannot
silently undercut a listing that fits the byte budget. Fixed structural
ceilings remain: 64 nested elements, 128 attributes per element and 256
simultaneously in-scope namespace bindings, including the predefined `xml`
binding. Repeated local declarations on sibling responses do not consume a
document-wide namespace budget. The standalone scanner retains its optional
node/attribute limits; the adapter explicitly supplies byte-derived budgets.
Fetch-response waits are bounded outwardly by caller abort and request timeout;
the adapter separately cancels pending body reads when aborted. These guarantees
do not force an uncooperative transport or response cleanup callback to stop.

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
When abort wins the pending-fetch race, `cause` is the combined request signal's
exact reason (the caller's reason or the deadline's reason). Existing pre-abort
rejection remains `ECANCELED` without a cause. Existing outer operations such as
`writeStream` may wrap the request error as their cause. Fetch failures when no
cancellation is observed retain their `EIO` translation and original cause; HTTP
status translation is unchanged. Fetch-race abort listeners are removed on
success, rejection, synchronous transport throw and abort.
Mutation multistatus failures report `EIO` with the individual mapped `FsError`
as `cause`. Earlier server-side changes may already have happened; there is no
rollback. A mutation multistatus without a reported failure is also rejected
rather than guessing that the operation completed.

## Optional resource comparison authority

`compareEntry(path, peer, peerPath, options?)` uses the approved metadata-only
comparison contract and the shared internal wrapper resolver. For two recognized
WebDAV adapter views it explicitly requests `DAV:resource-id` with Depth-0
PROPFIND. Both requested resources must return a valid successful property.
Missing properties return `unknown`; missing resources, authorization, malformed
or conflicting metadata, transport errors and cancellation do not become proof.
The existing XML/depth/entry/byte limits and rooted response-URL validation apply.
Only the requested resource's correctly namespaced, single successful property
is accepted. HTTP207 alone is insufficient. IDs are not dereferenced or fetched.

RFC5842 resource IDs identify backing resources across bindings and endpoint
aliases; endpoint strings, credentials and ETags do not. Full identifiers are
compared, not numeric hashes; UUID hexadecimal case is normalized. The guarantee
depends on a compliant provider preserving resource IDs across its actual
operations, not merely returning arbitrary property text. Base WebDAV/LOCK/COPY
support does not imply RFC5842 support. This Experimental extension is not server
authentication, a lease, an ABA defense or a pathname snapshot. Comparison sends
no GET, PUT, COPY, MOVE, DELETE or LOCK and cannot authorize an unknown existing
target, an unknown final symlink unlink, or a later overlay copy-up target.

Protocol resource IDs do **not** prove disjointness from local Memory/Real storage
or other protocols. The internal `getOwnedWebDavEntry` helper exposes closed-store
provenance only for the actual owned mock provider's registered whole fetch
function or its `MockDav.createFetch()` forwarding factory. It binds the actual
files Map/resource record, validates unchanged map-operation references, the
original transport, and every original adapter prototype method (including
buffered/streaming data operations and private metadata/request paths). Original
base method references are captured once at module initialization, not from an
instance after subclass overrides. Checks run before and after metadata queries;
both operands are rechecked before returning protocol proof. Unmodified subclasses
retain support; method overrides do not inherit base authority. Only validated
metadata observations are associated with the provider store.
An explicitly replaced `compareEntry` supplies separate external authority; it
does not inherit protocol/private-store proof. The internal terminal dispatcher
honors each such operand callback once, validates answers/conflicts and preserves
errors/cancellation. Forwarding recursively to the base negotiation stays unknown.
Nothing is published as a FileStat inode/scope or a public registry/trust flag.
Other backend owners still must recognize their own actual closed storage before
using this descriptor; its presence does not automatically authorize mixed copies.

A genuine mock PROPFIND Response is **not enough**: a custom fetch can forward
that Response while directing GET/PUT into an aliased local file. Such arbitrary
manual wrappers remain unqualified even if their metadata is genuine. HTTP and
Response cloning do not transmit private closed-store provenance; real HTTP uses
only the separate protocol comparison path. The approved provider factory captures
the qualified complete fetch mapping rather than guessing bound functions or
trusting client/URL names. Unrecognized custom transports stay unknown.

The owned `tests/fs/webdav/mock.ts` intentionally gains resource-id capability.
Its files remain an ordinary Map with existing byte/namespace behavior. Resource
records survive PUT and MOVE; COPY to a new target creates a distinct record,
COPY updating an existing target preserves that target's record, and deletion
retires it. Old mock source/raw evidence and new hashes are retained separately
in the resource-authority evidence directory; this is a provider capability delta,
not silently weakening the independent original compatibility assertions.

The earlier uncommitted resource-authority draft was unsafe for pre-construction
data-method overrides: constructor-time snapshots treated subclass methods as
original. Independent unchanged reproduction demonstrated source damage. Its raw
evidence is retained and explicitly superseded by the operation-override fix
evidence, not treated as a safe release or full positive acceptance.

The original compatibility fixture manually forwards `service.fetch`. Its two
mixed-memory existing-target cases therefore still need root approval for an
explicit input capability delta to `service.createFetch()` and a qualified
Memory-owner callback. This leaf does not edit that independent fixture. The
resource-id feature improves its WebDAV-only existing-copy/move cases without
claiming original mixed acceptance or universal provider interoperability.

Primary basis: RFC5842 sections2.7 and3.1 (immutable unique resource IDs and
explicit property discovery), and RFC4918 propstat/status processing. References:
`https://www.rfc-editor.org/rfc/rfc5842.html` and
`https://www.rfc-editor.org/rfc/rfc4918.html`.

## Safe cleanup workflows and the empty-collection gap

Safe empty-only `rmdir` remains unsupported for an empty remote collection, under
both existing overwrite policies. This is an honest required-workflow gap: the
unchanged aggregate adapter-tools checkpoint `421ce3f` records 77/79, with WebDAV
and S3 failing `/work/scratch/nested` cleanup. Neither this section nor the new
targeted tests turns that matrix green or claims alias closure.

For explicitly different workflows, applications can remove known owned files
with `rm(file)` while leaving parent collections, or stage scratch work in a
`MemoryFileSystem`. The latter uses bounded `readFile` plus explicit remote
`writeFile(result, bytes, { flag: "wx", signal })`, then local file removal and
local safe `rmdir`. Remote exclusive publication requires the provider to honor
the existing conditional request. This VFS-only, host-orchestrated byte transfer
is not cross-adapter rename, a transaction, or automatic command/mount portability.
Keep the local result until publication/reconciliation succeeds; lost replies may
leave remote effects. See `tests/stress/adapters/remote-safe-workflows.test.ts` for
exact byte, namespace, existing-target and unsupported-rmdir controls.

`rm(path, { recursive: true })` is available only for the **different intent of
destroying the requested subtree**, with possible partial effects. Never use it
as a fallback for `rmdir` or after listing an apparently empty collection. RFC4918
section9.6.1 gives collection DELETE recursive semantics; `Depth: 0` cannot make
it safe empty-only removal. Ordinary collection ETags do not establish membership
identity. A future integration must provide a reviewed authoritative emptiness
and removal guarantee, or coordination excluding every relevant writer. Existing
lock/ETag overwrite options are not an implemented safe-rmdir guarantee; this
task adds no protocol, lock lifecycle, or capability field. Primary reference:
`https://www.rfc-editor.org/rfc/rfc4918.html#section-9.6.1`.

## Verification

The additive rmdir checkpoint (August 26, 2026) passed all 35 combined S3/WebDAV
rmdir tests and all 503 combined adapter tests, with zero failures or skips:
`node --unhandled-rejections=strict --import tsx --test 'tests/fs/s3/*.test.ts' 'tests/fs/webdav/*.test.ts'`.
Strict NodeNext source-and-test typechecking for both owned adapter directories
also passed. The new `tests/fs/webdav/rmdir.test.ts` covers typed errors and
requested paths, empty/nonempty collections, post-PROPFIND child creation,
no mutation requests under either overwrite policy, pre-abort and uncooperative
in-flight cancellation with late rejection, and unchanged nonrecursive `rm`.
The rmdir evidence uses an injected mock, not a live-provider atomicity claim.

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
  sections 8.3, 9.1, 9.3, 9.6–9.9, 9.10.1, 9.10.3, 9.11, 10.2–10.4, 10.6,
  13, 14, and 20.6.
  `https://www.rfc-editor.org/rfc/rfc4918.html`
- W3C Namespaces in XML 1.0 (Third Edition), qualified names, namespace
  declarations/scoping, and expanded-attribute uniqueness.
  `https://www.w3.org/TR/xml-names/`
- W3C Extensible Markup Language (XML) 1.0 (Fifth Edition), character/name
  productions, comments, processing instructions, CDATA, and XML declarations.
  `https://www.w3.org/TR/xml/`
