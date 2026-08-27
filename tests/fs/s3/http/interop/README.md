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
`src/fs/s3/http` source overlay, without changing shared `dist`. The new transport
is imported from the isolated build's direct module until root approves package
export wiring. Existing Shell/VFS APIs use public `virtual-bash` exports. Every
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

These runs use the isolated direct HTTP module. They do not establish the newly
requested typed public-package factory consumer: its author fixture and real
export-map wiring were not yet available at this checkpoint. That separate
actual-service usability acceptance remains required, without changing exports
in this harness or pretending an undefined comparison resolver is usable.

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
