# Independent actual MinIO / S3 HTTP checkpoint

August27,2026. Scope ONLY tests/fs/s3/http/interop. No production, old tests,
contracts, exports, manifests or independent-review files changed.

## Pinned service and isolation

Official Darwin ARM64 MinIO RELEASE.2025-09-07T16-13-09Z, source commit
07c3a429bfed433e49018cb0f78a52145d4bedeb, binary108218434 bytes, SHA256
7c3b3039b76e55a1b80935848ed83998d5e8d317374f87851f46a019ff5c0aa4.
Both native-curl and the checked-in prepare script downloaded that exact binary
and matched the official checksum. Embedded runtime is go1.24.6 darwin/arm64;
the binary was not locally built. Node22.22.2 and native curl8.7.1 were available;
Docker/Podman/Go were absent. No package installation was needed.

Each process had synthetic credentials, an owned temporary HOME/data directory,
explicit127.0.0.1 API address and loopback console address. MinIO also opened ::1
on the API port; numeric lsof proved both listeners loopback-only. All requests
went to the recorded local port, never an external bucket. All completed servers
exited0 on SIGTERM and their owned data/home were removed. Downloaded executable
files are not committed. The release is historical, not a latest/security claim.

## Real wire guard results

Native curl's initial source-COPY request put x-amz-copy-source-if-match before
x-amz-copy-source in SignedHeaders. MinIO rejected both positive/negative probes
with SignatureDoesNotMatch403. This is a signer/harness failure, not source-COPY
unsupportedness. The replacement development-only signer matches TWO published
AWS example signatures independently and authenticates against actual MinIO.
The native curl observations remain immutable.

The final guard denominator is17;13 pass,4 remain genuine unsupported guards:
- Unsigned GET403 and wrong-signature PUT403 preserve existing source bytes.
- PUT IfMatch: correct200, stale412 unchanged, missing404 no publication.
- PUT IfNoneMatch: existing412 unchanged, missing200 exact bytes.
- COPY source IfMatch: correct200 exact copied bytes, stale412 no target change.
- COPY destination stale IfMatch incorrectly200 and overwrites target.
- COPY destination missing IfMatch incorrectly200 and creates target.
- COPY IfNoneMatch existing incorrectly200 and overwrites target.
- DELETE stale IfMatch incorrectly204 and removes target.
- Valid destination COPY, missing exclusive COPY and valid/missing DELETE have
  their separately recorded positive results; they do not excuse stale guards.
Every guard observation re-reads target and source. No expected error alternatives
hide the destructive cases. guards.mjs exits1 for the four unsupported guards.
Only verifiedConditionalOperations {put:true,copy:false,delete:false} is used in
the actual new transport tests. The initial missing-PUT exact oracle412 was a
profile mismatch: final explicitly asserts404 and no object creation; old raw
10/17 remains recorded, not rewritten as universal AWS conformance.

## Actual transport and workflow evidence

All six transport methods and streamed GET run against the real authenticated
service. Isolated builds succeeded. Public Shell/VFS exports are used; the new
transport uses its direct isolated dist module pending root export wiring.

| Cohort | Result | Classification |
| --- | --- | --- |
| Initial native-curl guards | 10/17 | Two signer failures, one wrong missing-PUT status oracle, four unsupported guards |
| Reference-signed guards | 13/17 | Four genuine unsupported guards retained |
| Initial transport | 11/16 | Four Buffer/Uint8Array assertion mistakes plus real LIST defect |
| Corrected transport | 15/16 | Real LIST defect retained |
| Expanded required workflows | 15/18 | LIST defect plus two required same-view cp failures |

The four assertion corrections compare exact bytes rather than Buffer subclass
identity; no status/error or byte/namespace expectation was relaxed. The first
Unicode fixture inadvertently removed its malformed character and only tested
ASCII; final uses actual café, retaining the original input snapshot. These
harness defects are preserved separately and not product-failure rebaselines.

Passing behavior includes binary/metadata PUT/HEAD/GET, real bad-signature403,
missing HEAD404, full positive/stale/missing/exclusive PUT guards, ordinary COPY
with already encoded source and source preservation, DELETE of only its selected
object, range/ETag/pre-abort, conditional-operation refusal before requests,
Memory-to-MinIO and MinIO-to-Memory existing-target Shell cp, real same-key alias
refusal, different-key cross-view copy, unknown-authority refusal before content,
metadata GET/conditional-PUT fallback and rename ENOTSUP before all I/O.

Application authority recognizes the actual process-owned physical store and
exact bucket/key mapping plus its separately owned Memory instance. It does not
infer storage from URLs/protocols/client IDs/ETags. No private mock helper or
per-client identity scope is used. Unknown existing destinations stay refused.

## Required remaining actions (not skips)

1. LIST: real MinIO returns encoding-type=url key pages/space+%2B%25 for the
   actual key "pages/space +%". The tested decoder returns "pages/space++%".
   Independent raw curl XML is preserved in list-wire-observation.json. Source
   owner must resolve URL-form decoding without changing literal-plus behavior
   for unencoded XML or altering the expected actual key.
2. Ordinary same-view Shell cp with enableCopy:false fails ENOTSUP for both
   existing and missing destinations. Source bytes survive, old target remains
   unchanged / missing target absent. These are useful required positives, not
   accepted refusal cases. Existing S3.copyFile invokes native CopyObject; its
   guarded GET/PUT fallback currently belongs to rename, which this service's
   unguarded DELETE correctly blocks. Root must coordinate any existing-adapter
   source scope; this leaf neither changes source nor enables false guards.
3. Keep conditionalCopy/delete false. Do not turn a source-only COPY condition
   or successful DELETE into aggregate guarded-copy/rename capability.

The18-case snapshot is base db62cc6e5a2742aeefdb1f9631758e71efdfe6ca plus the frozen
new HTTP source overlay. Tested transport.ts SHA256
9c03259d649da5a95190ec9546ac0d086bebcbee87b202ec01abb743f262dae2.
All six HTTP source files, source manifests and per-run build/argv/results are
preserved. Later concurrent source edits are NOT covered by this snapshot.

## Reproduction / artifact format

Use service.lock.json, prepare.mjs, guards.mjs and run.mjs as documented in the
owned README. Source/tests were frozen in isolated archives; shared dist was not
written. Artifact bundles list each original relative name, exact byte count,
SHA256 and base64 bytes, including binary payloads, CRLF headers, traces, JSON and
source inputs. No binary executable/temp bucket data is in the evidence commit.
SHA256SUMS verifies every committed artifact except itself. Earlier two startup
failures were overly restrictive listener checks (resolved names/IPv6 loopback),
not non-loopback exposure; both servers shut down before bucket operations.
The prepare script's initial Content-Length assumption failed on a valid
chunked/gzipped download; exact decompressed size/hash remain mandatory.

No fullrepo/allFS suite, commercial-provider certification, global atomicity,
snapshot, ETag-ABA, lifecycle/credential discovery or arbitrary gateway identity
guarantee is claimed. The old four-stress/alias evidence is untouched.

Primary sources:
- https://github.com/minio/minio/releases/tag/RELEASE.2025-09-07T16-13-09Z
- https://dl.min.io/server/minio/release/darwin-arm64/minio.RELEASE.2025-09-07T16-13-09Z.sha256sum
- https://docs.aws.amazon.com/AmazonS3/latest/developerguide/sig-v4-header-based-auth.html
- https://docs.aws.amazon.com/AmazonS3/latest/API/API_PutObject.html
- https://docs.aws.amazon.com/AmazonS3/latest/API/API_CopyObject.html
- https://docs.aws.amazon.com/AmazonS3/latest/API/API_DeleteObject.html
- https://docs.aws.amazon.com/AmazonS3/latest/API/API_ListObjectsV2.html
- https://raw.githubusercontent.com/minio/minio/07c3a429bfed433e49018cb0f78a52145d4bedeb/cmd/object-handlers-common.go
- https://raw.githubusercontent.com/minio/minio/07c3a429bfed433e49018cb0f78a52145d4bedeb/cmd/api-response.go
