# Independent local S3 service interoperability

This development-only harness runs an official, pinned, independently implemented
MinIO server. It is not an in-process S3 mock and does not add package dependencies
or production source. The selected historical release is
`RELEASE.2025-09-07T16-13-09Z`, source commit
`07c3a429bfed433e49018cb0f78a52145d4bedeb`, Darwin ARM64 binary SHA-256
`7c3b3039b76e55a1b80935848ed83998d5e8d317374f87851f46a019ff5c0aa4`.
The official release/checksum URLs and exact size are in `service.lock.json`.
This is a reproducible test profile, not a current-version/security recommendation.

## Reproduce

Prerequisites: Darwin ARM64, Node22, installed project development tools, native
`/usr/bin/curl`, `/usr/sbin/lsof`, and `tar`. Docker, Go and AWS SDKs are unnecessary.
Only the first command contacts the official binary-download site; bucket
operations are constrained to the launched loopback service.

```sh
node tests/fs/s3/http/interop/prepare.mjs
# Use the exact temporary binary path printed by prepare:
node tests/fs/s3/http/interop/guards.mjs /tmp/safe-bash-minio-download-XXXXXX/minio
node tests/fs/s3/http/interop/run.mjs /tmp/safe-bash-minio-download-XXXXXX/minio
node tests/fs/s3/http/interop/run.mjs /tmp/safe-bash-minio-download-XXXXXX/minio fallback
```

### Actual public-package consumer

```sh
node tests/fs/s3/http/interop/public-run.mjs --build-only
node tests/fs/s3/http/interop/public-run.mjs --download
```

The public runner copies the actual current source, real package manifest/configs,
and unchanged author `public-consumer.mts`/`build-public-consumer.mjs` into a fresh
`/tmp` archive. It invokes that author runner to build the real package, strictly
compile the consumer against the real export map, and import the compiled module.
Only after all three succeed does `--download` obtain the verified pinned binary
and launch an isolated service. An explicit existing binary path may replace
`--download`; externally supplied binaries are not deleted. Build-only is the
default and never launches/downloads. The author runner's Git call reads only the
real repository HEAD through explicit `GIT_DIR`; no temporary Git repo is created.
Shared dist, author files and package exports are never modified.

The compiled `runPublicS3Example` receives the owned loopback endpoint, synthetic
credentials, independently provisioned fresh bucket, unique prefix and explicit
verified-PUT/form-decoding profile. It runs **one workflow with nine named checks**,
not nine independent tests. Six additional reference-signed wire GETs check exact
final source/copy/target bytes. Public result, strict build diagnostics, manifests,
source hashes and lifecycle evidence go to the printed `/tmp` roots. Failures stay
failures; there is no private HTTP-module fallback or patched export map.
The service always stops and removes its owned data/home. An automatically
downloaded binary is hash-checked again and removed after the run.

The historical first public-runner replay records package-build0 and consumer-compile1:
TS2724 (`createS3HttpTransport`) and TS2305 (`S3HttpCredentials`) are absent from
the actual public S3 barrel. No service/download occurs. This blocker is separate
from the accepted direct-module18/18 and14/14; neither proves public usability.
Exact diagnostics and source snapshots are preserved in
`evidence/public-runner-first/REPORT.md`; that cohort has zero service workflows.

After real root/HTTP-subpath exports in `3c45ca2` and the aligned author consumer
in `b0ecf6a`, a fresh public run passes package build, strict consumer compilation
and import (all exit0), then **one actual-service workflow with nine named checks**
and **six independently signed final-object byte reads**. Root and
`virtual-bash/fs/s3/http` factory identity is asserted by the unchanged consumer.
See `evidence/public-acceptance/REPORT.md` for exact source/fixture hashes, raw
results and cleanup. This is author-example service acceptance, not the separate
root-independent adversarial review or a positive guarded-move result.

`prepare.mjs` verifies the official checksum against the checked-in digest and
bounds the decompressed binary by exact size and digest before making it
executable. Chunked/compressed download responses need not have Content-Length.
No binary is committed. `service.mjs` rechecks digest and embedded version before
every launch. It uses a fresh owned home/data directory, explicit synthetic
credentials and numeric IPv4/IPv6 loopback listeners only. Native curl has its
config/proxy lookup disabled. Child MinIO receives a minimal explicit environment,
not ambient credentials. `finally` stops the owned PID and removes its data/home;
logs, raw requests and exact input snapshots remain in the printed temp directory.

`run.mjs` builds a fresh archive of the recorded HEAD plus the current new
`src/fs/s3/http` source overlay, without changing shared `dist`. This historical
direct-module cohort keeps its isolated direct transport import; it is not
retrospectively reclassified as public-package acceptance. Existing Shell/VFS APIs
use public `virtual-bash` exports. Every
run records source/test hashes, build output, raw transport requests and results.
No whole-repository suite is run. `.mjs` checks are explicitly invoked, not silent
skips in the normal `.test.ts` suite.

The optional `fallback` cohort adds actual service positive/negative checks for
bounded GET/conditional-PUT copies: stale/missing source and destination
predicates, competing writes after destination observation, abort after source
headers, byte limits, metadata replacement/self-copy and unverified-PUT refusal.
Race injection uses the documented async credential-provider seam before the
next signed request; native response callbacks are forwarded immediately.
The raw competing writes are independently signed and recorded. These tests
distinguish deliberate competitor effects from forbidden fallback publication.

The MinIO transport fixture explicitly selects `listUrlEncoding: "form"` based
on the recorded `EncodingType=url` response `space+%2B%25`. No original flow
assertion changes with this profile selection. The transport default remains
percent decoding for other providers; no provider-name or endpoint inference is
used. The runner now records whether HTTP sources match their pinned commit and
whether the live HTTP source hashes stay unchanged during isolated validation.

## Measured provider profile

Seventeen guard observations include positive controls, stale and missing
predicates, exact target bytes/absence and source preservation. The reference
test-only signer independently matches the official AWS GET/PUT examples; actual
MinIO rejects unsigned GET and incorrect signatures. The historical native-curl
signing failure is retained separately, not called a provider limitation.

| Operation | Actual pinned MinIO behavior | Verified flag |
| --- | --- | --- |
| PUT If-Match | Correct succeeds; stale412; missing404, no creation | `put: true` |
| PUT If-None-Match | Existing412; missing succeeds | Covered by `put: true` |
| COPY source If-Match | Correct succeeds; stale412, no target change | Insufficient for aggregate copy flag |
| COPY destination If-Match/If-None-Match | Stale/existing conditions ignored; bytes overwritten | `copy: false` |
| DELETE If-Match | Stale condition ignored; object deleted | `delete: false` |

The guard suite is **13/17**, exits1 and retains all four unsafe-provider failures.
Positive acceptance alone is never proof of a guard. No HEAD/unconditional
mutation workaround or fabricated atomic rename capability is permitted.

The historical expanded transport/workflow cohort is **15/18** at the recorded source
snapshot: LIST misdecodes a space as `+`, and ordinary same-view Shell copies to
existing/missing targets fail with native COPY disabled. Those remain required
positive reds, not capability skips. See `evidence/checkpoint/REPORT.md` for exact
source hashes, intermediate harness corrections and remaining owner actions.

The unchanged eighteen assertions now pass **18/18** on committed HTTP source
`42bffab57cbaccbf08648527fc88d85e21a2ee4a`, with only the explicit form-decoding
configuration delta. Both same-view Shell copies succeed. The additional actual
bounded-copy cohort passes **14/14**, including stale predicates, concurrent
source/destination changes, cancellation and no-publication controls. See
`evidence/final-acceptance/REPORT.md` for raw intermediate/final observations and
source/fixture hashes. The old checkpoint is unchanged.

Native provider `verifiedConditionalOperations.copy` remains false. With native
COPY disabled, the effective bounded `copyObject` method now truthfully advertises
`conditionalCopy: true` based on verified PUT and guarded snapshot acquisition.
The native-COPY-enabled control still advertises false. Source predicates protect
snapshot acquisition, not later destination publication; this is neither an
atomic copy nor a snapshot/ABA guarantee. Conditional DELETE remains false.

These direct-module runs did not establish the typed public-package factory
consumer: its author fixture and real export-map wiring were not yet available
at that checkpoint. The subsequent, separately recorded public workflow above
executes that consumer without changing exports in this harness or substituting
an undefined comparison resolver.

## Authority and limits

The application owns this MinIO process's isolated physical store and a separate
Memory instance. Its constructor callback recognizes exactly registered views of
that actual bucket/key mapping and that owned Memory instance. Same bucket/key
views compare same; different keys in this actual store compare distinct. Unknown
views remain unknown. No endpoint, client ID, credentials, ETag, protocol name or
fabricated identity scope establishes disjointness. No private mock authority is
imported. The suite exercises real existing-target cross-adapter copies, aliases,
unknown refusal, conditional PUT metadata updates and honest rename refusal.

These point-in-time tests do not prove IAM breadth, virtual-hosted DNS/TLS, STS,
multipart, versioning, snapshot isolation, ETag ABA protection, atomic rename,
arbitrary gateway identity, production scalability or all real S3 services.
MinIO's unsafe conditional COPY/DELETE behavior is not an AWS behavior claim.

Primary protocol references: AWS S3 Signature V4 single-chunk examples,
PutObject/CopyObject/DeleteObject/ListObjectsV2 API documentation, and the official
MinIO release and source commit. URLs are retained in the evidence report.
