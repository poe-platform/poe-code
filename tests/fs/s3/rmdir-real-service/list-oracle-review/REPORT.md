# MaxKeys=1 oracle/source audit — author only

Started on `5216aefb494963283c5733408c5d7af621badb5b`; no product edits,
service launches, binary downloads, matrix runs or dependencies in this audit.
Root decides policy. The subsequent root handoff `ba200fe` authorizes a separate
implementation of the additive snapshot-marker profile; Curie is not an approval
gate. Historical sealed reports retain their original pre-handoff wording.

## Primary proof

`primary-sources.json` preserves complete fetched bytes, retrieval times, URLs,
SHA256 and six Git blob SHA1 values matched to the official repository's tree
for MinIO commit `07c3a429bfed433e49018cb0f78a52145d4bedeb`. The retained service
launch records that embedded commit/release and the independently checked
official binary digest `7c3b3039b76e55a1b80935848ed83998d5e8d317374f87851f46a019ff5c0aa4`.
No new binary was required; previous runs intentionally removed downloaded
binaries and retain their authentication records, not an executable.

AWS primary references, captured without changing their contents:
- `https://docs.aws.amazon.com/AmazonS3/latest/API/API_ListObjectsV2.html`
- `https://docs.aws.amazon.com/AmazonS3/latest/developerguide/sig-v4-header-based-auth.html`

AWS permits fewer results than MaxKeys. That does NOT permit a false completion
claim: IsTruncated=false means all results were returned; additional keys require
true and a continuation token. The token is opaque, not a key clients should
invent. Prefix selects matching keys. With delimiter `/`, a child whose remaining
name is simply `file` is not rolled into CommonPrefixes. These are general-bucket
LIST semantics, not a directory-bucket ordering argument.

Pinned source lines (raw Git blob line numbers):
- `cmd/api-router.go:510`: list-type=2 routes to ListObjectsV2Handler.
- `cmd/api-resources.go:69`: parses max-keys, prefix, delimiter and optional token.
- `cmd/bucket-listobjects-handlers.go:172`: authenticates ListBucket; line 210
  forwards those arguments to the object API.
- `cmd/erasure-server-pool.go:1371`: maps an absent continuation token/start-after
  to an empty marker and forwards to listObjectsGeneric.
- `cmd/erasure-server-pool.go:1674`: when prefix is nonempty, maxKeys is exactly
  one and marker is empty, GetObjectInfo(bucket, prefix) replaces enumeration.
  On success it appends that exact object and returns the named result without
  setting IsTruncated or NextMarker. This shortcut has no delimiter or user-agent
  condition. The normal listing closure is not called on this branch.
- `cmd/erasure-server-pool.go:1382` forwards the zero-value false/empty fields.
  `cmd/api-response.go:749` encodes the token, copies IsTruncated, and its response
  struct omits an empty NextContinuationToken. `cmd/object-api-datatypes.go:537`
  defines the underlying bool/string fields.

This source path explains the observations. It is static source tracing joined
to authenticated binary identity and existing runtime captures, not instrumented
branch coverage or a new reproducible build of MinIO.

## Wire and namespace verification

The new independent SigV4 recomputation matches the official AWS LIST example
including query sorting. It checks all 68 retained native request lines, actual
headers, payload hashes, canonical queries, response bytes and recorded statuses.
67 signatures match the service's synthetic secret. Request 67 intentionally uses
the wrong synthetic secret, matches that secret instead, and receives 403.
Response integrity here means preserved capture hashes, not signed S3 responses.

Native GETs 2/3 and 16/17 before the probes, and 24/25 afterward, prove distinct
keys `author/work/` (zero bytes) and `author/work/file` (exact `payload` bytes).
No fixture normalization, slash stripping or namespace substitution occurs.
Requests 18–23 address the same bucket/prefix with no start-after/token and no
duplicate query keys. MaxKeys=1 both with/without delimiter returns only the
marker, false truncation and no token. MaxKeys=2/1000 return both keys. Request
12 is a separate positive token/truncation parsing control for the parent prefix.

Classification: a **pinned-provider deviation from AWS completion semantics**,
explained by its exact-prefix optimization; not a signing/query/fixture defect
and not evidence of lost product pagination data. The original nonempty
ENOTEMPTY expectation is still valid and still FAILS under that profile. A
native utility faithfully reporting this response is not an AWS-conformance
oracle for prefix completeness. Neither a larger page nor HTTP200 establishes
universal provider correctness. Source proves maxKeys>=2 avoids THIS branch,
not every possible listing issue, cache effect or deployment configuration.

## Preserved failures and bounded checks

All original 606 sealed files verify unchanged; service remains **19/20**, with
zero historical positive product rmdir workflows. Original 77/79 is untouched.
This audit runs only four offline tests, now **4/4**, not new service acceptance.

The new auditor initially assumed every response carried Content-Length and
failed on an empty HTTP204. `first-audit.json` preserves its original input and
3/4 result. The only correction permits absent length specifically for captured
204 with zero body; every LIST still requires its exact length. This is an
auditor defect correction, not a rebaseline of the original service assertion.

## Obligations for the authorized implementation

- Declare the approved `snapshotRmdir: true` before exposing weaker success;
  no inference from backend name and no new API in this audit.
- Explicitly document/test a removal inspection request policy that avoids this
  known incomplete one-key shortcut. A minimum of two requested keys avoids the
  pinned branch, even with user pageSize=1; that would be an intentional, scoped
  request-policy change, NOT an assertion waiver or universal correctness proof.
- Require complete pagination before mutation; reject failed/invalid/repeated or
  missing-token pages. Treat all observed descendants, including nested markers,
  as ENOTEMPTY without deletion. Provider truthful listing remains prerequisite.
- Resolve an unambiguous explicit zero-byte marker. Protect roots, files, final
  symlinks, file/prefix collisions, malformed keys and nonzero slash objects;
  implicit directories do not supply a deletable marker.
- Delete exactly that marker once. No descendant/batch operation, fallback to
  recursive rm, rollback marker insertion or post-delete ENOTEMPTY claim.
- Preserve typed errors/read-only behavior and signals before/during host work.
  Issued-delete failure/abort may have effects; no rollback promise.
- Late children survive and may keep the directory visible after success;
  same-key replacement and same-content ABA are not protected by this profile.
- Conditional DELETE stays false on the measured MinIO configuration. Any
  stronger object condition needs separate evidence and still is not prefix
  emptiness. No atomicRename or absent-at-return claim follows.

Remaining work after this audit: implement the handed-off profile, then obtain
new frozen public-package/native-effect service evidence and separate verifier
acceptance. Those are not replaced by this offline primary-source proof.
