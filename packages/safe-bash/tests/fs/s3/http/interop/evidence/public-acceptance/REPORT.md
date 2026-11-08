# Actual public-package MinIO workflow acceptance

Captured August27,2026. This is service-owner execution of the unchanged author
consumer, not the separate root-independent adversarial acceptance review.

## Result and exact denominator

Command: `node tests/fs/s3/http/interop/public-run.mjs --download`.

- Actual package build: exit0.
- Strict public consumer compile: exit0.
- Compiled consumer import: exit0; root/subpath factory identity assertion passes.
- Actual service execution: **one workflow passed**, containing **nine named
  author checks**. These are not nine independent tests.
- Independent reference-signed final GET verification: **six objects**, each
  status200 with exactly expected bytes. These supplement the workflow rather
  than increase its test denominator.
- Runner exits0. No expectations, fixtures, source, manifests or exports changed
  in this leaf; no skips, private HTTP import fallback or export-map patch.

The named checks executed through actual S3FileSystem, MountFileSystem and Shell:

1. Create directories and exclusive binary source; reject repeat exclusive write.
2. List exact UTF-8, space, plus and percent filename and verify bytes.
3. Mounted same-view copy to both missing and existing targets.
4. Overwrite/read source and preserve the earlier copied snapshot.
5. Fresh application resolver recognizes distinct registered prefix views;
   cross-view copy preserves exact source/target bytes.
6. Overlapping bucket/prefix aliases compare same and copy refusal preserves bytes.
7. Unregistered and cross-provider views remain unknown; existing local target
   copy refusal preserves local and remote bytes.
8. Fresh missing metadata and exact caller cancellation propagate.
9. Guarded move is unsupported: typed ENOTSUP and nonzero Shell mv preserve both
   names and exact bytes. This is **not positive move acceptance**.

The final independent reads verify `work/source` and `other/target` are
`[66,0,67,255]`; `work/copy`, `work/existing`, and `work/雪 space +%` remain
`[0,255,128,10,65]`; `work/move-target` remains `[7,8,9]`. The consumer also asserts
the exact final work-directory names. All actual results and wire bytes are kept.

## Source, public API and build provenance

Observed HEAD and author consumer revision:
`b0ecf6a2982f490d72c828e725dcf48ee46a5583`.
Actual public export integration: `3c45ca2` (full hash in source evidence).
Root `virtual-bash` and dedicated `virtual-bash/fs/s3/http` expose the same factory;
the unchanged consumer imports S3FileSystem from `virtual-bash/fs/s3`. Its types
resolve solely through the real public package manifest. No S3-barrel factory
reexport is fabricated to match the historical failed consumer import.

Public consumer SHA256:
`190253ffc034bfea5a7af208cce2dc91bd0b6fb2be993fdb8623b9e5cbf4b1dd`.
HTTP transport SHA256:
`452cf4192a887ecf3ec03d10471e57ebf0432dae6e58bf1150cfa54d884686ad`.
Root source SHA256:
`93db829fa8897c5978d6a7e19e6fc974f980cd659f79be6fcfd2f868bad76613`.
Real package manifest SHA256:
`b183a9d2d451b5888b951a4e84656f6c18a94f09e7bd97e0a6af89ac48657e9b`.

The runner snapshots actual current source/configs and the unchanged author
builder/consumer into `/tmp/safe-bash-s3-public-interop-IpL2jc/archive`, then runs
the author builder there. Its isolated inner package uses the exact original
manifest/config bytes. Both source snapshots and live input hashes remain stable
during validation. The working tree contains unowned concurrent archive changes;
these are disclosed and their exact differing source bytes preserved, not called
a clean all-product committed-HEAD run. The relevant HTTP, export and consumer
inputs match their committed source. No shared dist or author directory is written.

`build-and-run.json` preserves raw command outputs, input/built-file hashes and
results. `source-snapshot.json` preserves full source hashes, bytes differing from
recorded HEAD, selected exact public API/consumer inputs and the actual compiled
consumer. It is possible to reconstruct that input state without modifying old
evidence or assuming the current moving worktree still matches.

## Independent service and authority profile

Official pinned MinIO Community `RELEASE.2025-09-07T16-13-09Z`, source
`07c3a429bfed433e49018cb0f78a52145d4bedeb`, Darwin ARM64, Go1.24.6,
108218434-byte binary SHA256
`7c3b3039b76e55a1b80935848ed83998d5e8d317374f87851f46a019ff5c0aa4`.
The official checksum is fetched/verified again before launch. This is a pinned
historical profile, not a latest-version or security recommendation. Node22.22.2
and native curl8.7.1 are development tooling, with no installed SDK/runtime deps.
`../../service.lock.json` records primary official download/release URLs.

Only after package build/compile/import succeed does the runner download and
launch MinIO, with synthetic fixture credentials and an owned fresh data/home.
Endpoint `http://127.0.0.1:63820`; PID71832. Exact launch argv/environment/version
are bundled. lsof confirms only `127.0.0.1:63820` and `[::1]:63820` listeners.
The independent signer, checked against both official AWS vectors, provisions the
fresh bucket and performs six final GETs. All bucket operations stay on loopback;
there are no private/ambient credentials, external bucket writes or TLS changes.

Fresh prefix: `public-5dc7a3d4-ee2f-4f0b-a35c-e9d5bf32ba35` in the new
`safe-bash-interop` bucket. The consumer's authority is a truthful application
mapping for this actual independent-object namespace. Registered filesystem views
map to real bucket/prefix/key routing; fresh stat errors and cancellation propagate.
No endpoint/client/credential/ETag identity or generic cross-provider disjointness
is inferred. Unknown foreign/unregistered views stay unknown.

Profile: native verified PUT true, native COPY false, DELETE false; native COPY
disabled selects bounded guarded GET/conditional PUT. Effective conditionalCopy
is true; conditionalDelete and atomicRename remain false. Explicit form decoding
retains the previously evidenced MinIO LIST profile. Copy remains multi-request
and byte-bounded; source predicates protect snapshot acquisition, not later
publication. This is not a lease, atomicity, ETag ABA or snapshot guarantee.
An additional independently verified capable provider is needed to prove positive
guarded move. No unsafe unconditional-delete workaround is proposed.

## Immutable history, cleanup and review boundary

The historical `public-runner-first` build failure remains unchanged, including
TS2724/TS2305 and zero service workflows. The author intentionally aligned public
imports after real export integration; this public consumer delta is explicit,
not an unchanged-original-import claim. Direct-module15/18,17/18,18/18 and14/14
remain distinct; native13/17 still has four unsupported COPY-destination/DELETE
controls and is not rebaselined or rerun into a different denominator.

Service output: `/tmp/safe-bash-s3-service-ZqvXss`. PID71832 exited0 at
2026-08-27T04:15:57.817Z; task-owned data/home are removed. The automatically
downloaded binary is hash-checked again and removed. Sealing verifies no owned
service PID remains and preserves shutdown/download/listener evidence. Raw logs
and snapshots remain for review; no binaries or synthetic service data are committed.

This bounded run establishes actual compiled public-package usage against this
service/profile. It does not establish universal S3-provider support, positive
move support, IAM/TLS/STS/multipart/versioning breadth or full-product closure.
Root's separate independent review remains required.
