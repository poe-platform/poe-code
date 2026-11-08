# Independent real S3 HTTP/SigV4 review

Checkpoint: August 27, 2026. This is an independent review of the original
transport author, not universal AWS/S3 compatibility or a whole-repository gate.
The reviewer made the two small source fixes below; a **different verifier is
still required for those changes**.

## Frozen inputs and ownership

- Full source/package/original HTTP tests: commit
  `0d29f4d5e90cebc6976a51ddbeba883288126aa0`.
- Fixed run: that same full baseline with **only `src/fs/s3/http/**` overlaid**
  from `f65038e0d3e62b7fe4c05b47c1ab9d3ee364abbb`. Do not interpret this as a run
  against every intervening change on the shared working branch.
- Production changes are confined to `transport.ts` and `xml.ts` within that
  directory. Original author tests, other FS, shell, contracts and exports are
  unchanged. New review tests/scripts/evidence live exclusively in this folder.
- `evidence/final-prepare.json` records every production source SHA-256, actual
  packed archive hash, Node binary hash, lock hash, build/import/type commands
  and their full output. `evidence/freeze-and-cleanup.json` records original
  author input hashes, reviewer input hashes, host profile and cleanup.
- The frozen files were compiled and packed with the **actual package manifest**,
  unpacked into a separate consumer, then imported through `virtual-bash` and
  `virtual-bash/fs/s3/http`. No fabricated package exports or private mock
  transport identity substitutes for the public consumer.

## Results, without merging unlike denominators

| Cohort | Original source | Fixed source |
| --- | --- | --- |
| Unchanged author unit tests, including four AWS signing vectors | 69/69 | 69/69 |
| Independent protocol tests | 34/38 | 38/38 |
| Independent lifetime/binary/bounds tests | 22/22 | 22/22 |
| Combined unit counterexamples | 125/129 | 129/129 |
| Unchanged author MinIO transport checks | 18/18 | 18/18 |
| Unchanged author MinIO guarded fallback checks | 14/14 | 14/14 |
| Unchanged author strict native guard cases | **13/17**, exit 1 | **13/17**, exit 1 |

The combined original 125/129 is the sum of separately captured original
69/69, 34/38 and 22/22 cohorts, not a claimed single original combined invocation.
The initial protocol draft was 33/37; the additional valid-empty-comment positive
control produced 34/38 before either source fix. Both captures are retained.
Final 129/129 ran together, with zero skips, cancellations or TODOs. Scoped strict
types and the frozen complete production build pass. No current global test/type
gate is claimed amid other owners' edits.

Additional fixed-source controls:

- **5/5 deliberately bad mutations detected**: remove origin backslash guard
  (2 failures), accept invalid XML comments (2), claim conditional PUT by default
  (1), reuse caller upload storage (1), remove GET quota (2). Mutations ran only
  in a disposable source copy; each original file was restored and hash checked.
- Actual unchanged public consumer: **9/9 checks**, plus **6 independent native
  exact-byte GET witnesses**. This is a workflow with nine checks, not nine
  independent backend capabilities.
- New packed public workflow: **16/16 checks**, comprising **8 positive workflows,
  5 safety guards, 2 explicitly expected refusals, and 1 capability check**.
  Twenty independent native GET witnesses check bytes or absence. Real LIST
  continuation requests were observed with `pageSize: 2`.
- New native guard corpus with different binary data and fresh credentials:
  **13/17**, `nativeStrictStatus: 1`. Positive selected-workflow runner exit 0
  does **not** turn the four failing native guards into passes.
- The separate test-oracle HMAC signer passes all **4 literal AWS vectors**;
  this validates a test oracle, not four extra product cases.

## Two source defects reproduced before fixing

1. **Endpoint normalization hid forbidden paths.** The origin-only constructor
   accepted `http://127.0.0.1\unexpected` and
   `https://example.invalid\@path`. WHATWG URL parsing interpreted a pathname,
   which the transport silently discarded. Excluding backslash in the authority
   grammar makes both configurations fail with `InvalidArgument` before I/O.
   This is a reproduced configuration-validation defect, **not** a demonstrated
   cross-host credential disclosure.
2. **Malformed XML comments could acknowledge COPY success.** A complete HTTP200
   COPY result prefixed or suffixed with `<!--invalid--->` was accepted. XML 1.0
   comment grammar forbids that trailing hyphen. The parser now rejects it with
   `InvalidResponse`; empty comments and ordinary internal hyphens still work.

These two fixes and four red-to-green regressions are in source/test commit
`f65038e`. No provider capability was enabled and no author expectation changed.

## Actual independent service and supported workflows

This worker downloaded a new official **MinIO Community
RELEASE.2025-09-07T16-13-09Z**, source
`07c3a429bfed433e49018cb0f78a52145d4bedeb`, Darwin arm64 / Go 1.24.6, verified
the official checksum and file size before execution:

```text
108218434 bytes
SHA256 7c3b3039b76e55a1b80935848ed83998d5e8d317374f87851f46a019ff5c0aa4
```

This is a pinned historical interoperability profile, not a latest-version or
production-security recommendation. Each service had fresh task-owned data/HOME,
explicit synthetic credentials, ephemeral loopback listeners, and no external
buckets. All eight service processes exited; all eight data/HOME directories and
the downloaded binary were removed. Binary content is not committed. Textual
evidence and frozen build snapshots remain. No unrelated process or data was
stopped/deleted.

Verified configuration:

```ts
createS3HttpTransport({
  endpoint: explicitLoopbackEndpoint,
  region: "us-east-1",
  credentials: explicitSyntheticCredentials,
  allowInsecureHttp: true,
  listUrlEncoding: "form",
  enableCopy: false,
  verifiedConditionalOperations: { put: true, copy: false, delete: false },
});
```

Effective guarded copy is available through bounded source GET plus conditional
destination PUT; **native conditional COPY remains disabled**. Verified PUT means
both matching/new positive cases and stale/existing negative cases were measured,
not that the service merely accepted a header.

The eight positive packed workflows exercise directory/exclusive binary creation
and reads; paginated names containing Unicode, spaces, `+` and `%`; actual Shell
`cat | base64 | base64 -d` publication; `cp` to missing destination; `cp` overwrite
of a known distinct object; overwrite while preserving an earlier copy; an HTTP
source piped into a separate memory mount; and ordinary `rm`. The application
comparator uses fresh stats and an explicit mapping of two registered FS objects
to this one bucket/prefix namespace. Alias-copy protection is tested, without
claiming different clients/endpoints/ETags imply distinct backing objects.

### Strict native failures retained

| Operation | Expected guard | Actual pinned MinIO result |
| --- | --- | --- |
| COPY, stale destination If-Match | 412; old destination preserved | 200; destination overwritten |
| COPY, missing destination If-Match | 412; destination absent | 200; destination created |
| COPY, existing destination If-None-Match `*` | 412; old destination preserved | 200; destination overwritten |
| DELETE, stale If-Match | 412; object preserved | 204; object deleted |

Source-COPY matching/stale guards, conditional PUT matching/stale/missing and
exclusive creation, authentication negatives, and positive/missing deletion
controls were measured alongside these failures. Original author 13/17 captures
are preserved in both baseline/fixed replay evidence.

`S3FileSystem.rename` and Shell `mv` refuse with no data loss under this profile
because guarded DELETE is unavailable, even when non-atomic rename is requested.
Safe empty-directory `rmdir` remains `ENOTSUP`: listing emptiness is not an atomic
empty-prefix deletion predicate. Those two expected refusals are **not supported
move/rmdir workflows**, and are backend limitations rather than defects in this
HTTP transport. Conditional GET/PUT snapshot copying does not solve ABA, acquire
a source lease, or make rename atomic. A provider-committed mutation can outlive
a client cancellation or lost response; rollback is not promised.

## Preserved test-oracle corrections

The initial independent packed-service capture is deliberately retained at
**15/16**, with native-signer guards **11/17**, not overwritten by the final run.

1. The new FS pre-abort assertion incorrectly expected raw reason identity.
   Existing S3FS `check()` at `src/fs/s3/filesystem.ts:178` and its README explicitly
   expose typed `ECANCELED`; raw reason identity is the transport-level behavior
   already tested separately. Only this new assertion changed to `ECANCELED`,
   still checking original remote bytes afterward. No author expectation or
   production cancellation policy changed. The original source and failure are
   in `initial-harness-inputs.json` / `initial-public-service.json`.
2. Apple `/usr/bin/curl` **8.7.1** produced invalid SigV4 when both
   `x-amz-copy-source` and `x-amz-copy-source-if-match` were supplied. The exact
   local on-wire control shows the longer header first in `SignedHeaders`, hence
   an invalid signature; the single-header positive control verifies correctly.
   MinIO returned `SignatureDoesNotMatch` for both matching and stale source
   predicates. Those two initial rows are **oracle failures**, not evidence that
   the service does/does not enforce those predicates. The other four are the
   strict provider failures retained above.
3. The final entire native guard/read corpus uses the same native curl binary as
   raw HTTP sender with an independently written HMAC signer, checked against
   four literal primary AWS vectors before service startup. It imports no product
   signer, does not switch signer selectively by expected outcome, and records
   exact signed headers. Fresh positive and negative service probes then reproduce
   the author **13/17** profile. This is not described as a native-curl-signing
   success. `curl-prefix-headers.json` contains the native oracle defect proof.
4. The first mutation-driver attempt selected an obsolete XML test name and ran
   zero matching tests. It was rejected by the driver's status assertion, not
   counted as a killed mutant. The initial output is retained separately; fixing
   the selector yields the actual five detected mutants.

The unchanged author's `transport-summary.json` still contains the historical
phrase “pending approved package export.” It is left untouched. The separate
actual packed root/subpath proofs and real public workflows establish exports
for this freeze; that stale summary string is not current export evidence.

## Coverage and limits

The 60 independent protocol/lifetime cases cover raw signed dot segments,
repeated slashes, Unicode composition, literal percent, punctuation, NUL/newline
and backslash keys; query sorting and opaque continuation tokens; session token
signing; trusted virtual-host routing; mutation of caller upload storage;
301/302/303/307/308 non-following; complete COPY200 embedded errors and malformed
XML; one-pass LIST decoding and invalid pagination/scalar values; capability
defaults; credential-provider late rejection/deadlines; pre/post-header abort;
abandoned/early-return body cleanup; 1 MiB exact binary reads; single-use chunks;
valid/invalid ranges; truncation; native header bounds; XML byte bounds; and no
destination publication after an oversized, stale or canceled fallback read.

Raw exotic-key wire preservation and session-token tests use independent local
HTTP fixtures; they are **not a claim that MinIO accepts every such key or that
real STS/session credentials were exercised**. Actual MinIO acceptance uses the
binary/Unicode/percent/space/plus public workflows. Its form-style LIST decoding
is an explicit profile choice; default percent decoding is tested separately.

The injected Node-compatible request factory is trusted host code. It must
preserve signed method/path/headers/body, cancellation and intended authority.
The virtual-host test uses explicit loopback connection routing while retaining
the signed Host. This is not a sandbox for malicious host JavaScript. Native
requests reject redirects rather than forwarding credentials; no universal
SSRF policy is supplied by this transport.

Upload streaming is absent and `streamingWrite` remains false: byte-array PUT
is bounded/snapshotted, even though socket writes honor backpressure. No AWS
production service, Linux service control, STS/IAM policy deployment, TLS CA
deployment, multipart/versioned buckets, access-point routing, checksum
negotiation or universal S3 provider acceptance was tested here. Transport limits
are not one shell-wide resource budget. No new runtime dependency was added.

## Reproduction

From the repository, ordinary counterexamples need no service:

```sh
node --unhandled-rejections=strict --import tsx --test \
  tests/fs/s3/http/unit/*.test.ts \
  tests/fs/s3/http-independent/*.test.ts
```

For the exact fixed public profile (requires the pinned Darwin arm64 service):

```sh
node tests/fs/s3/http-independent/prepare.mjs f65038e0d3e62b7fe4c05b47c1ab9d3ee364abbb
# Use the printed directory as SETUP; it contains a fresh packed consumer.
node tests/fs/s3/http-independent/validate.mjs "$SETUP"
node tests/fs/s3/http-independent/download-service.mjs "$SETUP"
node tests/fs/s3/http-independent/replay-author-service.mjs "$SETUP"
node tests/fs/s3/http-independent/minio-service.mjs "$SETUP" "$SETUP/minio"
node tests/fs/s3/http-independent/mutants.mjs "$SETUP"
```

The service runners remove their own service data/HOME in `finally`; remove only
the newly downloaded `$SETUP/minio` after all runs. `finalize-evidence.mjs` is the
one-time audit recorder for this review's baseline/initial/final directories; it
verifies hashes and process/data cleanup, removes that baseline-owned binary,
then writes evidence through `apply_patch`. It is not an automatic golden updater.

## Primary references inspected

- AWS single-chunk SigV4: canonical header-name ordering, literal S3 paths,
  byte encoding and four published signature vectors:
  https://docs.aws.amazon.com/AmazonS3/latest/developerguide/sig-v4-header-based-auth.html
- AWS COPY: HTTP200 can contain an embedded error; read the entire response:
  https://docs.aws.amazon.com/AmazonS3/latest/API/API_CopyObject.html
- AWS LIST encoding/continuation contract:
  https://docs.aws.amazon.com/AmazonS3/latest/API/API_ListObjectsV2.html
- W3C XML 1.0 Fifth Edition section 2.5, production 15 (comment grammar):
  https://www.w3.org/TR/xml/#sec-comments
- WHATWG special-authority URL parsing (backslash handling):
  https://url.spec.whatwg.org/#special-authority-ignore-slashes-state
- Pinned curl 8.7.1 source `make_headers`: lines 254–285 sort complete
  `name:value` strings before removing the colon, explaining the independently
  observed prefix-header misordering; no claim about every curl version:
  https://github.com/curl/curl/blob/curl-8_7_1/lib/http_aws_sigv4.c
- Official pinned MinIO release and checksums:
  https://github.com/minio/minio/releases/tag/RELEASE.2025-09-07T16-13-09Z
  https://dl.min.io/server/minio/release/darwin-arm64/minio.RELEASE.2025-09-07T16-13-09Z.sha256sum

Evidence timestamps are UTC. The service pin, Node/library versions, raw strict
failures, oracle correction and test/source changes remain independently
inspectable rather than being summarized as unqualified green acceptance.
