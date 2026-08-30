# Independent S3 snapshot-rmdir verification

August 27, 2026. Independent leaf evidence, not source-author evidence and not
self-approval of the broader project. No production regression was found in
these bounded cohorts. The original matrix still fails its stock WebDAV row.
No claim of universal parity, provider conformance, superiority, full-project
completion or 72 hours of work follows from this report.

Harnesses, frozen packages, raw runs and offline audits are committed in
`41c39d8`; this report and `SHA256SUMS` form the separate closing evidence seal.

## Exact frozen inputs

| Role | Exact commit / identity |
| --- | --- |
| Complete production and package snapshot | `04879692a66d88eee129b8ffd6e7ca93c7a9476a` |
| S3 source checkpoint | `5660248b1ff89572a6164d0b0c7bd22d03630d9b` |
| Approved contract checkpoint | `ba200fec275dbda8c30cc368252cd61b6d42527c` |
| Original unit/wrapper/alias/integration/service assertions | `df780f6ddb6292283114461ff4f9ebacfb269205` |
| Original79 fixture, matrix, preflight and WebDAV helper | `debb29ead94ae387f359d9d04b333ee4380f88d6` |
| Production `src` tree | `f7479a1c8d893bb25eee5ca26d2d0a5efed0a157` |
| S3 tree at both source566 and wrapper048 | `da2cfcbf8a485ed3414523163c4858d27750af2c` |

`evidence-onRW9e/freeze.json` records 264 committed inputs, exact hashes, Node
binary hash/version, platform, development-tool package metadata and live dirty
status. Its three Git archives retain their exact bytes. No live source overlay
was applied. The contract `.ts` and `.md` bytes equal ba200fe, and the entire S3
tree equals source566. Matrix fixture/helper bytes also equal wrapper048; no
fixture waiver or assertion change was introduced. Original assertions executed
from isolated copies, not their original directories.

`original-seal.json` seals 1,158 original evidence/harness files before execution;
both runs and the final offline audit confirm they remain unchanged. Each
subprocess has exact argv, cwd, timestamps, status, counts, stdout and stderr.
The initial recorded freeze was 07:48:33.578 UTC; the corrected source freeze was
07:50:06.304 UTC and its cleanup completed 07:50:21.644 UTC. These are measured
execution-phase timestamps, not a claim about an unmeasured work duration.

## Packed emitted module closure

The corrected build and package contain 636 emitted files: JavaScript,
declarations and their maps. `emitted-closure.json` hashes every file and verifies
packed bytes against the isolated build. The complete tarball is retained.

| Artifact | SHA-256 |
| --- | --- |
| `virtual-bash-0.0.0.tgz` | `65c1ed68f3a071ca720f4334c307887d8341865bc5b2b866e615a98bcde9d558` |
| Source `src/fs/s3/filesystem.ts` | `9ac11951d681db45cee474568ca46d227cfb5bbd9b0d5ce2d6c176d0c4f94833` |
| Runtime `dist/index.js` | `27a19e8e4f5505e3aad5395d13e0a4c17e54d4096aac872261580220b28f2c1a` |
| Runtime `dist/fs/s3/index.js` | `1c174c48e88516790e1776bf32b87597a29a79b029dd06aa972acf061c3d647f` |
| Runtime `dist/fs/s3/http/index.js` | `7e356b1ee365ce29d6c66d4f08f1447e7d79f551fd9fb79c0076e3924f679479` |
| Runtime `dist/fs/s3/filesystem.js` | `8a29148a5e41ed27087cd9784c564623b73d9c6c79f52ec2710db0cd29fba680` |
| Runtime `dist/fs/mount/index.js` | `251a379e39df16d0573b4f8f6ce2282e533545c9f8a0198bd703178c44208211` |
| Runtime `dist/fs/overlay/index.js` | `6bf995bbf66ac2cd6ad068db9fa8cdd4df8e1c1d70734a20b196ce6bba5e07ad` |
| Runtime `dist/fs/readonly/index.js` | `e9a155116c7ba93605ab1be43fb1c5c4618e164398f5bfb25d6659f41eb28289` |

Actual service import resolution, recorded inside the executing consumer:

```text
file:///Users/kjopek/Workspace/safe-bash/tests/fs/s3/rmdir-independent/.isolated-WCsASJ/consumer/node_modules/virtual-bash/dist/index.js
file:///Users/kjopek/Workspace/safe-bash/tests/fs/s3/rmdir-independent/.isolated-WCsASJ/consumer/node_modules/virtual-bash/dist/fs/s3/index.js
file:///Users/kjopek/Workspace/safe-bash/tests/fs/s3/rmdir-independent/.isolated-WCsASJ/consumer/node_modules/virtual-bash/dist/fs/s3/http/index.js
```

The loader records hashes of all **144 actually loaded product modules** during
the service process, compares loader-provided source against on-disk bytes, and
rejects emitted imports outside the unpacked package. Probe, independent tests
and actual service each match the full packed/build manifest. Unexecuted emitted
modules remain frozen, not mislabeled as dynamically covered. Root/subpath
factory identity is an additional check, not the provenance proof.

The pre-boundary control really resolves to shared repository `dist/index.js`
despite an unpacked `node_modules/virtual-bash` already being present. A distinct
consumer `package.json` is written before product import. Public declaration
consumer checking and public runtime tests both pass after that boundary.

## Unchanged replay results

| Cohort | Pass / total | Exit | Interpretation |
| --- | --- | --- | --- |
| Original S3 + HTTP | 382/382 | 0 | 44 focused + 269 other S3 + 69 HTTP |
| Original snapshot wrappers | 16/16 | 0 | Mount, overlay, readonly |
| Original alias guards | 49/49 | 0 | Existing mount/overlay identity guards |
| Original combined Shell integrations | 6/6 | 0 | Separate integration cohort |
| Original preflight | 30/30 | 0 | Separate fixture controls |
| Original adapter/tool matrix | **78/79** | **1** | Stock WebDAV `rmdir` remains ENOTSUP |
| New independent packed tests | 24/24 | 0 | Guards and explicit race limitations |
| Actual pinned service observations | 20/20 | 0 | **Four** positive workflows, not twenty |
| Offline independent evidence audit | 7/7 | 0 | Closure, signatures, effects, seals |

Build, scoped strict types and packed public-consumer types exit zero. Cohorts
overlap; these numbers must not be added into a distinct-coverage denominator.
The sole matrix failure is unchanged:
`webdav: create, copy, append, inspect and remove files`, with `rmdir: ENOTSUP`
at `/work/scratch/nested`. Historical 77/79 and unbuilt 58/79 remain untouched.

## Independent adversarial matrix

| New cases | Count | Expected outcome and effects |
| --- | ---: | --- |
| Hidden byte child, nested marker, hidden nested child | 3 | ENOTEMPTY; complete pagination; marker and bytes preserved; zero DELETEs |
| Missing/string completeness, missing/empty/cyclic token, incomplete second page, foreign/missing-size/noncanonical/nonempty-slash entries, self-prefix, absent listed marker | 12 | Typed EIO/ENOTSUP/ENOENT; zero DELETEs |
| Endless valid incomplete pages | 1 | EFBIG at configured budget; zero DELETEs |
| Abort after completed LIST with errno-shaped reason | 1 | ECANCELED; transport `abortSignal` forwarded; zero DELETEs |
| Late hidden binary descendant | 1 | Success removes only marker; exact bytes survive; logical directory remains |
| Equal-ETag marker replacement | 1 | Replacement marker is removed; explicit ABA limitation, not protection |
| Dynamic routed snapshot capability | 1 | Live mount disclosure; overlay refusal; zero DELETEs, no whiteout |
| Profile enabled during final overlay readdir | 1 | Synthetic memory-backed host; no removal delegation or hidden late child |
| Actual S3 upper, lower-only overlay directory | 1 | Earlier atomicRename ENOTSUP gate; no copy-up, DELETE or hiding |
| Readonly S3 adapter and readonly wrapper | 2 | EROFS; zero DELETEs |

All new S3 cases explicitly reject any child DELETE. Race cases allow one exact
marker DELETE, never recursive fallback or descendant cleanup. The dynamic
final-readdir test deliberately uses a memory-backed synthetic snapshot host
with truthful memory atomic rename; it tests the wrapper's later profile guard.
It is not evidence that real S3 offers atomic rename. The actual S3 lower-only
test hits the earlier atomicRename refusal and is not claimed as later-guard
coverage. The routed test constructs a strict mount before changing its backend;
it verifies live snapshot disclosure, not live recomputation of every capability.

## Actual MinIO observations and wire proof

One official dev-only binary download, one service launch:
MinIO Community `RELEASE.2025-09-07T16-13-09Z`, embedded source
`07c3a429bfed433e49018cb0f78a52145d4bedeb`, Darwin ARM64, 108,218,434 bytes,
SHA-256 `7c3b3039b76e55a1b80935848ed83998d5e8d317374f87851f46a019ff5c0aa4`.
The official checksum, observed size/hash, exact version, listener addresses,
argv, synthetic environment and shutdown are retained. No latest-release or
production-security recommendation is implied.

The original 20 service assertions are unchanged, with SHA-256
`4a6f97721863916a6af1c3e8e0d6ff468536a5800cf4ca50b263cb73ac1724af`.
Their author metadata stays unchanged in raw output; the enclosing independent
receipt identifies this as a new execution. The copied service/download harness
changes only its owned output prefixes, with before/after hashes and exact text.
Transport setup retains form LIST decoding, verified PUT and disabled native
COPY; the existing guarded copy fallback is not a native conditional-COPY claim.

| Category | Observations |
| --- | ---: |
| Capability profile | 1 |
| Positive public workflows: API, Shell rmdir, Shell rm -d, binary pipeline | **4** |
| Explicit nonempty guards | 2 |
| File/missing/root/implicit-directory negatives | 4 |
| Readonly plus pre-aborted denial | 1 |
| Ambiguous representation guard | 1 |
| Late-child snapshot race | 1 |
| Same-content ABA limit | 1 |
| Actual authorization error | 1 |
| Abort after LIST | 1 |
| Abort after issued DELETE HTTP204 | 1 |
| Synthetic response loss after actual DELETE HTTP204 | 1 |
| Native stale If-Match limitation | 1 |

The 134 product requests contain nine rmdir marker DELETE attempts: eight HTTP204
and one HTTP403. A tenth DELETE is the explicitly requested pipeline file `rm`,
not rmdir child cleanup. Offline auditing whitelists each of the nine exact marker
paths and verifies zero DELETEs in every nonmutating guard observation. Three
late descendants survive; public stat still observes the logical directory.
Two HTTP204 marker deletions are followed by caller-visible ECANCELED/EIO;
there is no reinsertion, retry or rollback claim.

All 65 independently issued native requests have their signatures recomputed by
the new auditor, checked against an official AWS LIST signature vector. Request
targets, payload hashes, response status lines and response bytes agree with raw
captures. This authenticates request construction and retained bytes, not a
cryptographic signature on server responses. Product success/denial is separately
observed against the actual authenticated service; its loaded bytes are bound by
the runtime loader records.

Ten of the native requests are an additional independent shortcut probe: two
PUTs, six LISTs, two GETs. Same bucket/prefix, no token/start-after: MaxKeys=1 with
and without delimiter returns only the marker, false truncation and no next
token; MaxKeys=2/1000 return both distinct keys. Final GETs confirm the marker and
hidden child `[0,255,128,10]` survive. These six wire variations are not added to
the original20 denominator and involve no additional service download/launch.

## Primary-source interpretation

`primary-evidence-jrKWp8` captures fresh AWS ListObjectsV2 documentation, the
pinned MinIO server-pool source, and its official Git tree. Six retained pinned
source blobs have independently recomputed Git blob IDs matched to that fresh
tree; the fresh server-pool bytes match the retained SHA-256. Source tracing is
not instrumented branch coverage or a reproducible build of MinIO.

AWS permits a page to contain fewer than MaxKeys, but false IsTruncated declares
completion; further results need continuation. The pinned source's
`cmd/erasure-server-pool.go:1674` condition is nonempty prefix, maxKeys equal to
one, and empty marker. It fetches the exact prefix object and returns it without
normal enumeration or setting truncation/next-marker fields. The V2 mapping at
line1371 forwards these values. This explains the authenticated false-completion
wire deviation; fewer-than-MaxKeys permission does not excuse it.

S3 rmdir's `Math.max(2, pageSize)` at the frozen source line521 is a bounded
workaround for this exact branch. It is not a universal provider-completeness
proof. Malformed, failed, missing-token, cyclic-token, absent-completeness and
budget-exhausted pagination are refused before mutation in the measured tests.
Truthful provider listing remains a prerequisite. No guessed continuation token,
marker reinsertion or recursive fallback is used.

Primary locations are recorded with retrieved bytes, hashes and timestamps:

```text
https://docs.aws.amazon.com/AmazonS3/latest/API/API_ListObjectsV2.html
https://raw.githubusercontent.com/minio/minio/07c3a429bfed433e49018cb0f78a52145d4bedeb/cmd/erasure-server-pool.go
https://api.github.com/repos/minio/minio/git/trees/07c3a429bfed433e49018cb0f78a52145d4bedeb?recursive=1
```

## Preserved failed verifier attempts and historical qualification

- `evidence-jgwdUq` retains the first frozen build, pack, exact new test source,
  22/24 result and cleanup. Its cancellation fixture incorrectly inspected
  `options.signal` instead of transport `options.abortSignal`; that assertion
  itself threw and was translated to EIO. The other fixture expected a late
  overlay guard despite S3's earlier atomicRename ENOTSUP gate. Correcting these
  verifier assumptions produced 24/24 without any product/original-test edit.
- The primary auditor first looked for `gitTree.tree` instead of the retained
  `selectedEntries`; its next attempt mismatched the exact AWS phrase by omitting
  “of the.” Both verifier defects are retained. Neither was a source failure;
  the successful audit uses the real captured wording and fresh official tree.
- The historical author **19/20** and failed **9/20** retain their raw outcomes.
  Their product bytes are **UNAUTHENTICATED**: a pack/build hash or factory
  identity assertion cannot defeat Node's repository self-reference. The 9/20
  stack names shared `dist`; the old19 layout has the same trap without enough
  captured loaded bytes to authenticate what ran. Nothing here repairs that
  history retroactively. Their native wire/signature evidence remains separate.
- The corrected author's old20 is not this verifier's execution. This new run
  independently records all loaded product module hashes and the original20
  unchanged assertions, rather than inheriting its acceptance label.

## Refusals, non-guarantees and cleanup

`conditionalDelete` remains **false**. Native stale If-Match returns204 and
removes its object instead of412; no guard guarantee is inferred. Snapshot rmdir
is **not atomic**, has **no marker-instance/ABA protection**, makes **no
directory-absent-at-return promise**, and is **not bucket-universal**. Versioned,
locked, lifecycle-modified, externally deployed or other-provider buckets were
not tested. General AWS or deployed-provider behavior is not certified. The
binary service is a single local pinned configuration, not AWS itself.

All source/build/consumer trees, private npm cache, downloaded binary, synthetic
service home/data and native children were removed through owned cleanup paths.
MinIO exited0. No external bucket, ambient home/configuration, global TLS/env,
runtime dependency, shared `dist`, unowned native directory, original evidence or
unrelated staged change was modified. Raw proof remains intentionally retained.
`audit.test.mjs` confirms both original/frozen input seals and cleanup again.

The remaining measured product failure is the original stock WebDAV rmdir
ENOTSUP row. That is reported, not waived or fixed outside this leaf's ownership.
