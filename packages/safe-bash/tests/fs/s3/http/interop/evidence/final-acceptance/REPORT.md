# Independent actual-service acceptance: original18 and bounded-copy14

Captured August27,2026. This checkpoint closes the unchanged eighteen-flow
actual-service cohort, not all S3-provider or public-package usability work.

## Exact inputs and results

Both final isolated builds pin committed source
`42bffab57cbaccbf08648527fc88d85e21a2ee4a` and exit0. All HTTP files match that
commit and their live hashes remain unchanged before/after both runs. Complete
source/test manifests, exact HTTP source bytes, fixture snapshots, launch inputs,
listener checks and raw wire/results are preserved in the adjacent JSON bundles.

| Cohort | Result | Classification |
| --- | --- | --- |
| Original expanded transport/workflow baseline, b93005a evidence | 15/18 | Historical LIST and two ordinary-copy source failures; unchanged evidence |
| Explicit form profile, e2082b3 HTTP source | 17/18 | Missing-target same-view copy still rejected by effective capability gate |
| Committed0b23295 replay | 17/18 | Same remaining gate; preserved before/after manifests |
| Final42bffab original flow assertions | **18/18** | Only input delta is explicit MinIO form profile |
| Initial additional fallback harness | 10/14 | Three delayed-callback harness failures and one prototype-sensitive assertion |
| Corrected additional fallback, before effective-capability fix | 14/14 | Exact predicate/error/bytes assertions retained |
| Final42bffab additional fallback | **14/14** | Actual service negative/race/cancel/bounds and positive controls |
| Repeated independent native service guards | **13/17**, exit1 | Four genuinely unsupported native destination-COPY/DELETE guards remain red |

The original18 fixture SHA is
`b489a1711f0b9f4a8f06ac5ab5b8b7140f2c3f38a73703170ad5f91d0d35d9a4`.
The profile-only candidate SHA is
`edf0fc66eea791954f2dce7b2bc6e2d8242f854339c43855bbc7b6274bff9fba`.
`fixture-delta.json` retains both exact byte sequences and verifies that removing
only `listUrlEncoding: "form"` reproduces the committed old fixture. There are no
changed expectations, alternate error allowances, skips or denominator changes.
The selected decoding is supported by old raw URL-marked XML
`space+%2B%25`; it is explicit configuration, not guessed server behavior.

Final HTTP transport SHA256:
`452cf4192a887ecf3ec03d10471e57ebf0432dae6e58bf1150cfa54d884686ad`.
Prior e208/0b232 transport SHA256:
`ce19e4a347d50d84fb87b993c862717fc57fed183b584bc4b0ca04bcecb3a728`.
All six HTTP source file hashes appear in each build's provenance. This leaf
changes no production source, exports, contracts, manifests or other tests.

## Service and wire provenance

Official independent MinIO Community binary
`RELEASE.2025-09-07T16-13-09Z`, source commit
`07c3a429bfed433e49018cb0f78a52145d4bedeb`, Darwin ARM64, embedded
Go1.24.6; exact108218434-byte binary SHA256
`7c3b3039b76e55a1b80935848ed83998d5e8d317374f87851f46a019ff5c0aa4`.
This is a pinned historical profile, not a latest/security claim. The official
download/checksum/release URLs are in `../../service.lock.json`; the fresh
download and official checksum bytes are bundled in `download.json`.
Node22.22.2 and native curl8.7.1 run the independent dev harness. No SDK/runtime
dependency, container or Go installation was used. Native reference signing
passes both recorded official AWS GET/PUT vectors. Actual MinIO rejects bad
signatures and unsigned access; this is wire SigV4, not a self-mocked server.

Every service invocation is recorded as:
`minio server --address 127.0.0.1:<allocated> --console-address 127.0.0.1:<allocated> <owned-data>`.
Each `launch.json` has exact argv, PID, version, synthetic credentials, minimal
environment and endpoint; `listeners.txt` verifies numeric loopback only.
Native curl disables config and proxies and permits HTTP only to that endpoint.
No external bucket operations, private credentials, ambient home lookup, global
TLS changes, or non-owned data are used. Exact request headers/payloads/responses
and byte snapshots remain losslessly recoverable from base64 bundles.

## Required behavior and genuine limits

All six transport operations execute on the independent service: HEAD, binary
GET/PUT, native unconditional COPY, selected DELETE and paginated LIST. Exact
names, bytes, metadata, range/ETag errors and cancellation are asserted. Actual
Shell/VFS copies succeed Memory-to-MinIO, MinIO-to-Memory, across registered
same-service views and within one view to both existing and missing targets.
Same-key aliases and unknown authority refuse before content/mutation, preserving
bytes. Application backing authority is explicit actual isolated-store routing,
not URL/client/credential/protocol disjointness or ETag identity.

Native verified profile remains `{ put: true, copy: false, delete: false }`:
PUT correct predicates succeed; stale412/missing404 and exclusive-existing412
preserve exact bytes/absence. Native COPY source predicates work, but destination
predicates are ignored and overwrite/create. Native stale conditional DELETE
actually removes bytes. These four unsupported controls stay visible in13/17.

With `enableCopy:false`, the effective bounded `copyObject` now advertises
`conditionalCopy:true` because GET snapshot acquisition and conditional PUT
enforce the supported predicates. This is not a promotion of native COPY support.
Native-COPY-enabled control remains false. The additional14 prove existing and
missing positive copy; stale/missing source; stale/missing/exclusive destination;
competing destination creation/replacement; source replacement; exact caller
abort reason; byte limit; metadata self-copy; and unverified-PUT preflight refusal.
No native COPY or DELETE occurs anywhere in that additional cohort. Rejected
publication preserves source and target, including intentional competitor bytes.

Initial race injection wrongly delayed native response callbacks until an async
competitor completed, producing502 before headers were delivered. Corrected
injection uses the documented async credential resolver between destination HEAD
and source GET; native callbacks run immediately. Initial metadata assertion
compared a null-prototype record with a plain object. Its correction asserts the
exact complete entries. The original10/14 raw inputs/errors remain preserved.

Source predicates protect snapshot acquisition, not later publication. Copy is
bounded and multi-request, not atomic, leased, ABA-safe or snapshot-isolated.
Conditional DELETE and atomicRename remain false; rename is typed ENOTSUP before
effects, never downgraded to unsafe copy/delete. This service cannot prove a
positive guarded move; another independently verified capable provider is needed.
TLS/virtual-hosted DNS, IAM breadth, STS, versioning/multipart, arbitrary gateways,
large-scale behavior and universal S3 interoperability are not established.

## Reproduction, public-consumer boundary and cleanup

Run `node tests/fs/s3/http/interop/prepare.mjs`, then use its printed binary path:

```
node tests/fs/s3/http/interop/guards.mjs <binary>
node tests/fs/s3/http/interop/run.mjs <binary>
node tests/fs/s3/http/interop/run.mjs <binary> fallback
```

The guard command deliberately exits1 for13/17. Both final transport commands
exit0 and build in their own archives; shared dist and root configs are untouched.
`cohorts.json` records all exact original output roots. Bundles hold the inputs
needed to recreate old runs even after subsequent fixture/source edits.

These runs import the new factory from its isolated direct built module while
existing Shell/VFS imports use public exports. The newly requested complete typed
public-package factory consumer is a separate outstanding author/export-wiring
gate: neither that fixture nor public HTTP barrel wiring existed at this run.
No manifest is patched and no public-factory usability success is claimed here.

All seven recorded service PIDs exited0; their task-owned data/home directories
were removed. Final sealing checks the downloaded binary hash before deleting
that owned binary. Shutdown and binary-cleanup evidence is adjacent. Original
`evidence/checkpoint/**` remains immutable. No service is left running by this leaf.
