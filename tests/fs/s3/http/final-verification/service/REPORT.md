# Independent final service-profile replay

## Verdict and scope

The requested fixed-source MinIO profile reproduces in a fresh verifier batch,
without source edits or changed fixtures. This is **not** universal S3 acceptance,
whole-product acceptance, superiority evidence, or a current global test gate.
The strict native guard cohort is **still red: 13/17, exit 1**, with the same four
known unsupported predicates. No new product bug was observed in this replay.
The separate protocol verifier owns the two-defect counterexamples and mutants;
this leaf does not claim to have rerun those cases.

The batch ran August 27, 2026, 04:57:27.853–04:57:42.767 UTC (14.914 seconds of
automated batch execution, not total review time or a 72-hour work claim).

## Exact frozen inputs

- Full baseline: `0d29f4d5e90cebc6976a51ddbeba883288126aa0`.
- Only `src/fs/s3/http/**` overlaid from
  `f65038e0d3e62b7fe4c05b47c1ab9d3ee364abbb`; the production delta is confined to
  `transport.ts` and `xml.ts`.
- Read-only independent runners/fixtures and handoff:
  `42056669f2373f2d34a96bce39aecb940f183ebc`. All copied inputs match committed
  bytes; original author inputs match the full baseline. Existing expectations,
  binary fixtures, and prior evidence were neither edited nor regenerated.
- Actual package manifest, isolated complete production build, `npm pack
  --ignore-scripts`, unpacked public consumer, strict NodeNext declaration
  consumers, and runtime root/subpath factory identity all passed. There is no
  source fallback, export-map rewrite, or private mock identity marker.
- The unchanged author transport/fallback runners retain their original isolated
  `dist/fs/s3/http/index.js` import. They are not relabeled packed consumers.
  Separate unchanged public consumers import the installed package through
  `virtual-bash` and `virtual-bash/fs/s3/http` and prove the public surface.
- All 165 production source files, generated build files, package files and
  installed packed files were frozen and checked before/after. A post-run seal
  also checks the archived source, packed tarball and copied fixture bytes.

SHA-256:

```text
packed tarball  715d17a9f73be1f3c767899a2849ec58b326fd6cfabe4e073c774482ef8543e2
package.json   b183a9d2d451b5888b951a4e84656f6c18a94f09e7bd97e0a6af89ac48657e9b
package lock   9c04bb7d2c7d1894479f0c37ce367987c2130256e5bfbf426cfa1bd2729d740b
transport.ts   73611a0d279cec24d85d14031a02d92607979977ef926245fe0a6f9e7eb6161d
xml.ts         73598f1a2aedbf22a5d455849dae4f7e80f022d5ad847f136b2d1d6ecc99301e
source archive 378a93951046227f40f0a7ce023d69d468f7ed0f4010d474b695d08d671e78e7
```

The complete per-source hashes are in `evidence/prepare.json`. The packed archive
and all source hashes exactly match the earlier handoff's final frozen package.
This is a fresh execution of that package, not merely reuse of its result files.

Current HTTP source matched the overlay both before and after. The working tree
was not globally clean: unrelated workers' files were present and HEAD advanced
from `aba917c69ba949ffaa5f844b4181c713415fe891` to
`3a2d9ca5bee8dfdc61d99213cbdf8496afc8fd8f` during this batch. No measured current
source/package bytes changed during the batch. Seven current source files differ
from this deliberately older full freeze: archive README/extract/format, SafeJS
README/index, and shell parser/runtime. Their exact paths and before/after hashes
are retained in `evidence/audit.json`; they were **not** implicitly included in
the tested baseline. No dependency or package configuration changed.

## Results: keep the denominators separate

| Cohort | Result | Interpretation |
| --- | --- | --- |
| Unchanged author transport | 18/18, exit 0 | Original transport assertions |
| Unchanged author guarded fallback | 14/14, exit 0 | Original bounded-copy safety assertions |
| Unchanged author strict native | **13/17, exit 1** | Four provider predicate failures remain red |
| Independent native corpus in public runner | **13/17, nativeStrictStatus 1** | Same four failures, different unchanged binary fixtures |
| Packed public checks | 16/16 | **8 positive workflows + 5 guards + 2 expected refusals + 1 capability check** |
| Packed native witnesses | 20/20 | Exact bytes or absence, not 20 additional capabilities |
| Author public workflow | 9/9 checks in one workflow | Not nine independent backend capabilities |
| Author native witnesses | 6/6 | Independent exact-byte GET checks |
| Built-in prepare author unit cohort | 69/69 | Required by unchanged prepare; no skips/TODOs |
| Independent HMAC signer controls | 4/4 AWS vectors | Oracle validation, not extra product tests |

The selected public runner exits 0 without hiding its `nativeStrictStatus: 1`.
The outer replay driver exits 0 only because the requested exact profile was
reproduced, including the unchanged strict runner's real exit 1. The original
strict assertions remain unchanged and the four cases remain failed rows.

Real LIST continuation requests with `pageSize: 2` were observed. Positive packed
workflows cover binary exclusive creation/read, Unicode/space/plus/percent names,
actual Shell binary pipelines, missing/existing-target `cp`, snapshot preservation
after overwrite, transfer to a separate memory mount, and ordinary `rm`.

## Native failures and truthful capabilities

| Predicate | Required outcome | Observed service outcome |
| --- | --- | --- |
| COPY destination stale If-Match | 412; old destination preserved | 200; destination overwritten |
| COPY destination missing If-Match | 412; destination absent | 200; destination created |
| COPY existing If-None-Match `*` | 412; old destination preserved | 200; destination overwritten |
| DELETE stale If-Match | 412; object preserved | 204; object deleted |

Authentication negatives, source-COPY matching/stale predicates, conditional PUT
positives and negatives, and ordinary deletion controls still pass. Native
conditional COPY and conditional DELETE remain **false**. Effective conditional
copy is **true only through bounded GET plus conditional destination PUT** with
native COPY disabled. This does not establish atomic rename, a source lease,
ABA protection, rollback after cancellation, or cross-provider identity.

Direct rename and Shell `mv` are safe **ENOTSUP refusals**, not positive move
support; the source and target bytes remain intact. Safe empty-directory `rmdir`
also remains an expected **ENOTSUP refusal**, not a supported workflow.
Streaming write remains false. No capability was enabled by either source fix.

## Official binary, service count, isolation, cleanup

One fresh official MinIO Community development binary download was used:
`RELEASE.2025-09-07T16-13-09Z`, source
`07c3a429bfed433e49018cb0f78a52145d4bedeb`, Darwin arm64, Go 1.24.6.
The official checksum response, downloaded binary digest, exact **108218434-byte**
size, release/commit version output and final download URL are preserved.

```text
SHA256 7c3b3039b76e55a1b80935848ed83998d5e8d317374f87851f46a019ff5c0aa4
```

This is a pinned historical interoperability profile, not a latest-version or
production-security recommendation. Node is v22.22.2; exact Node binary digest,
Darwin profile, native curl version, commands and output are in the evidence.

**One bounded batch required exactly four sequential MinIO service instances**,
not one long-lived service. This preserves the unchanged runners' lifecycle:

| Instance | PID | API loopback port | Exit |
| --- | --- | --- | --- |
| Author transport | 89220 | 57848 | 0 |
| Author fallback | 89769 | 58409 | 0 |
| Author strict guards | 90178 | 58524 | 0 (its test runner exits 1) |
| Combined author/independent packed workflows and native corpus | 91021 | 58596 | 0 |

Each used fresh task-owned data/HOME, explicit synthetic credentials and loopback
API/console bindings. The original author runner intentionally creates its own
`/tmp/safe-bash-s3-service-*` temporary output; this was not silently patched to
honor TMPDIR. The build and combined public service used this leaf's ignored
`.scratch-*` directory. Exact environment, listeners and paths are recorded.
The first three use `safe-bash-synthetic` / the original synthetic secret; the
fourth uses `independent-s3-review` / its original fixture-only secret. No ambient
provider credentials, external bucket, TLS-global change or package installation
was used. Native curl is solely the host test oracle, not a product subprocess.

All four services exited in their unchanged runners' `finally` blocks. All four
data directories and all four HOME directories are absent; the downloaded binary
was removed in the outer `finally`. No fallback termination was needed. Process
checks found **no active owned service or task-scratch child processes**. Only
owned binary/data/HOME were deleted; build snapshots and raw request artifacts
remain for inspection. No other worker's files, children or staging were touched.

## Native curl signing is not product curl

The handoff's `http-independent/evidence/curl-prefix-headers.json` preserves a
local Apple `/usr/bin/curl` 8.7.1 `--aws-sigv4` defect: with both COPY-source
headers, `SignedHeaders` places `x-amz-copy-source-if-match` before its shorter
prefix `x-amz-copy-source`. Those original `SignatureDoesNotMatch` outcomes were
oracle failures, not evidence about whether MinIO enforced the source predicates.
This batch leaves that historical evidence unchanged and uses the unchanged
reference/independent HMAC signers for all native signed requests; curl merely
sends their signed headers and bytes. The independent signer passes the four AWS
vectors. This is neither native-curl signing acceptance nor an exercise/failure
of virtual-bash's optional product `curl` plugin; that plugin is outside this batch.

## Reproduce and inspect

From the repository on the pinned Darwin arm64 profile, with the existing Node
development tooling available and a new evidence directory name:

```sh
node --unhandled-rejections=strict tests/fs/s3/http/final-verification/service/replay.mjs evidence-new
node tests/fs/s3/http/final-verification/service/verify.mjs evidence-new
```

The wrapper executes the existing prepare/download/author/public service scripts
read-only. It copies and strictly compiles the unchanged independent public
consumer using validate.mjs's exact compiler recipe rather than running its
combined129/type cohort. No mutants, global suites, or new transport cases run.
Every subprocess has an explicit deadline; existing service runners also retain
their deadlines. Existing evidence directories are refused rather than overwritten.

Evidence inventory:

- `prepare.json`: complete build/pack/types/import output, source and package hashes.
- `download.json`: official binary download and checksum/size verification.
- `author-service-replay.json`: unchanged18/14/17 outputs, raw failed rows and exits.
- `packed-public-service.json`: unchanged16/9 workflows,20/6 witnesses,17 native rows,
  signed requests, product request trace, listeners and shutdown.
- `raw-author-*.json`, `raw-packed-native.json`: every retained original artifact,
  losslessly base64 encoded with its own SHA-256, including headers/body/trace files.
- `audit.json`: exact commands, timing, source/build/packed before/after hashes,
  old input hashes, concurrent-tree observations and finally cleanup.
- `SHA256SUMS.json`: hashes of the nine original evidence artifacts.
- `seal.json`: separate read-only artifact/hash/fixture/package verification and
  final process/data/HOME/binary absence checks, plus replay/verifier script hashes.

The report and evidence must be read with the failed native rows intact. This
review accepts only this fresh replay of the established two-source delta.
