# Explicit S3 HTTP / SigV4 transport

`createS3HttpTransport(options): S3Transport` implements the existing six-operation
client contract without a runtime dependency. Its local entry point is `index.ts`.
Package/root re-exports are separately owned; this subtree does not change them.

```ts
import { createS3HttpTransport } from "./index.js";

const transport = createS3HttpTransport({
  endpoint: "https://s3.us-east-1.amazonaws.com",
  region: "us-east-1",
  credentials: {
    accessKeyId: "EXPLICIT_APPLICATION_KEY",
    secretAccessKey: "EXPLICIT_APPLICATION_SECRET",
  },
});
```

No credentials, region or endpoint are loaded from environment variables,
credential files, the home directory or metadata services. Credentials can instead
be an explicit async function `({ signal }) => Promise<S3HttpCredentials>`.
It is called per operation; refreshing and caching credentials are the host's job.
Optional `sessionToken` is sent and signed. `clock?: () => Date` defaults to the
system clock. Signed credentials and bodies are never logged by product code.

## Options and trust boundary

- `endpoint`: an explicit HTTP(S) **origin**, with optional trailing slash; no
  endpoint path, userinfo, query or fragment. HTTP requires `allowInsecureHttp:true`.
  HTTPS verifies certificates; the transport does not mutate TLS globals.
- `addressingStyle`: `"path"` (default) or `"virtual-hosted"`. The latter requires
  a DNS endpoint, prepends the bucket, and requires appropriate DNS/certificate
  coverage. There is no region discovery, redirect following or automatic retry.
- `listUrlEncoding`: `"percent"` (default) or `"form"`. This applies only when a
  LIST response declares `EncodingType=url`. Form encoding converts literal `+`
  to space before one percent decode; `%2B` remains a literal plus. Select it only
  for an explicitly measured provider profile, not by endpoint-name guessing.
  Unencoded XML keys and opaque continuation tokens are unaffected in both modes.
- `request`: optional Node-compatible `(RequestOptions, onResponse) => ClientRequest`.
  The factory must preserve the exact signed method, headers, body and raw path,
  deliver a native binary `IncomingMessage`, honor destruction/backpressure and
  preserve the declared provider namespace. It is trusted host code, not a sandbox.
  A caller can supply explicit connection policy here without global changes.
- `maxPutBytes` and `maxGetBytes`: 64 MiB each by default; positive safe integers,
  maximum 1 GiB. The GET limit applies to buffered **and** streamed responses.
- `maxXmlBytes`: 4 MiB by default, at most 16 MiB. Applies to LIST, COPY, error and
  mutation response bodies. Request/response headers and request targets are each
  bounded to 16 KiB; object keys to 1024 UTF-8 bytes; user metadata to 2 KiB.
- `requestTimeoutMs`: 30 seconds by default, maximum 2,147,483,647. This is an
  absolute operation deadline including credentials, headers and consumption of
  the response body. Slow or abandoned streaming consumers also reach this limit.
- `enableCopy`: true by default. False disables native COPY. If conditional PUT
  is verified, `copyObject` uses the bounded conditional-PUT fallback described
  below. Otherwise it fails `NotImplemented` before network effects.

Host-supplied credentials/transport callbacks are trusted. Endpoint strings,
bucket names, credentials, ETags and content hashes are **not** backing-identity
proof. HTTP responses do not carry the private mock's identity observations.
Existing-target cross-view copies may need the existing `S3FileSystem` constructor
`compareEntry` callback with a truthful application backing resolver. Unknown
relationships stay unknown. Connectivity alone never makes namespaces disjoint.

## Conditional capability policy

All conditional capability flags default **false**. Header support or a successful
conditional request alone is not proof of enforcement. The explicit option
`verifiedConditionalOperations?: { put?: boolean; copy?: boolean; delete?: boolean }`
asserts that the selected provider and this wire serialization have independently
passed both satisfying and failing predicates with exact byte/namespace checks.
The transport performs no destructive capability discovery at construction.

- `put:true`: actual enforcement of destination `If-Match` and `If-None-Match:*`.
- `copy:true`: actual enforcement of source `x-amz-copy-source-if-match` **and**
  destination `If-Match`/`If-None-Match:*` by native provider COPY. The coarse
  existing contract cannot advertise only native source-condition support.
- `delete:true`: actual enforcement of `If-Match` before deletion.

Native conditional mutation requests reject `NotImplemented` before network when
their corresponding flag is false. Unconditional operations remain available. No HEAD
check followed by an unconditional write/delete emulates atomic preconditions.
Incomplete provider support must be reported, not promoted to a verified profile.
With verified PUT and native COPY disabled, ordinary bounded copies and the
existing metadata fallback are available; guarded non-atomic rename additionally
requires verified DELETE. The existing `capabilities.conditionalCopy` describes
the **effective `copyObject` implementation**: with native COPY enabled it requires
verified native COPY; with native COPY disabled it is true only for the implemented
guarded bounded fallback with verified PUT. Keep `verifiedConditionalOperations.copy`
false for the measured MinIO profile: its native 13/17 guard observations remain
unchanged. Effective fallback support is not promotion of native provider support.
The transport does not claim ABA protection, transactionality, global atomicity,
ETag incarnation identity, or snapshot isolation across multiple requests.

### Bounded COPY fallback

The frozen `S3FileSystem.copyFile` does not itself recover from disabled native
COPY. This transport therefore implements its `copyObject` fallback when
`enableCopy:false` and verified PUT are configured. Caller-supplied destination
conditions are retained; absent those, HEAD captures destination ETag or absence
and selects `If-Match` or `If-None-Match:*`. Source GET uses any supplied source
predicate, requires returned ETag/length, and validates complete bytes within both
GET/PUT limits. Metadata is copied or replaced according to `MetadataDirective`.
The final PUT always carries the destination predicate. No source DELETE occurs.
One deadline covers all requests. Missing ETag, denial, cancellation, stale source,
destination race or excessive size fails without an unconditional retry.

This preserves guarded publication but is **not** an atomic server-side COPY:
the source can change after its GET snapshot, and a failed response can follow a
provider-committed PUT. No source lease is claimed. A successful fallback returns
the PUT-confirmed ETag; it does not fabricate server LastModified. Effective
conditional-COPY support permits the existing adapter's exclusive-copy gate to
reach the guarded fallback, including mounted missing-target copies. The supported
source predicate is one ETag (or `*`), evaluated at GET snapshot acquisition, not
again at destination publication. General HTTP ETag-list matching is not claimed.
Conditional DELETE and `FileSystem.capabilities.atomicRename` remain false for
the measured MinIO profile. No shared contract or legacy adapter change is needed.

## Protocol and lifetime behavior

The encoded request target is constructed once, signed, and passed as Node's raw
`path`. Object keys never pass through WHATWG URL path resolution: literal dot
segments, repeated slashes, percent signs and UTF-8 survive the actual wire.
Queries encode names/values individually and sort encoded pairs. All supplied
headers are normalized once, signed, then sent with the same values. PUT snapshots
the bounded byte array before asynchronous credential resolution/hash/upload.
Writes use bounded chunks and honor request backpressure. There is no streaming
upload method and `streamingWrite` is false; `streamingRead` is true.

GET returns raw binary bytes, without transparent decompression. Range responses
must report matching status/range/length, and returned ETag must agree with an
explicit IfMatch when present. Streaming bodies are single-use. Abort before
headers, during body consumption or while unread destroys request and response;
iterator return also closes an unread body. Late errors are observed. Abort or
timeout cannot roll back a PUT/COPY/DELETE already accepted by the provider.

COPY accepts the **already encoded** `CopySource` from the existing client
contract. Source and destination predicates use different headers. Its complete
bounded XML body is parsed even for HTTP 200; an embedded Error is a failure.
LIST requests `encoding-type=url`, decodes returned keys/prefixes once when that
encoding is declared, and never URL-decodes opaque continuation tokens. LIST
returns one page; the existing filesystem owns pagination and cycle/entry limits.

The bounded XML parser accepts XML 1.0 UTF-8, default namespaces, comments, CDATA,
predefined/numeric entities and ordinary attributes. It rejects DTD/external
entities, processing instructions, invalid UTF-8/code points, malformed nesting,
duplicate scalar fields, depth over 32 and more than 32,768 nodes. Unsupported
namespaced element prefixes fail rather than silently returning an empty listing.
Provider errors retain `S3ServiceError.code` and `$metadata.httpStatusCode` for
existing FsError wrapping. Non-XML HTTP failures retain their HTTP status.

## Unsupported / acceptance boundaries

Only existing standard buckets and object operations are covered. No bucket
creation, multipart operations, upload streaming, presigning, anonymous access,
S3 Express session auth, access-point ARN routing, version IDs, ACL/KMS options,
SSE-C headers, transparent compression, region retries or checksum negotiation.
Metadata values are printable ASCII; whitespace follows signing normalization.
The provider's single-copy size limit is not a multipart implementation.

Author tests use AWS's published signing vectors and native Node HTTP loopback
sockets. These are not service acceptance. Independently owned pinned-service
evidence is under `tests/fs/s3/http/interop/`; preserve unsupported guard results
alongside positive interoperability. No universal AWS/S3-compatible parity follows
from one service/version or from accepting its headers.

## Primary references

- AWS single-chunk SigV4 examples (GET, PUT, lifecycle, list):
  https://docs.aws.amazon.com/AmazonS3/latest/developerguide/sig-v4-header-based-auth.html
- AWS COPY syntax, destination/source conditions and HTTP 200 embedded errors:
  https://docs.aws.amazon.com/AmazonS3/latest/API/API_CopyObject.html
- AWS LIST encoding, pagination and invalid-XML warning:
  https://docs.aws.amazon.com/AmazonS3/latest/API/API_ListObjectsV2.html
- AWS conditional DELETE:
  https://docs.aws.amazon.com/AmazonS3/latest/API/API_DeleteObject.html
- Node HTTP request path and stream lifecycle:
  https://nodejs.org/api/http.html

References inspected August 27, 2026. Test vectors are pinned literal expectations,
not expectations regenerated by the implementation under test.
