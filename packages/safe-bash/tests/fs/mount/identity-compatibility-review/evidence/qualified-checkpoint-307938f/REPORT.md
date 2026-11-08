# Preserved intermediate checkpoint: 307938f

This is the independent baseline captured before the final late-authority fixes,
not final FS closure. No original acceptance assertion or live fixture changed.

## Pin and integrity

- Source: `307938f17db2714db9debc451f935e3134e2660e`.
- Contract: `5076b32dee1b8ca6d1ed757216f3f5bed17cb379`; mandatory core ancestor
  `0bee8e7d4866c333044bfcb2353db3e888399006` verified.
- Archive SHA256: `9fa8ad561bfbab7c0b799c088799c835c8edf9d0b793c3a999c029dfdbef48c2`.
- Source-set SHA256: `3acf6a8cfa85852f60f81aa1c78b6c9e5e323a45f5ca333cc1977708581b878a`.
- Original43 fixture SHA256:
  `9d11741fd9b37757046c1278fdaa00c734633bfd9a1fc58ae479415c2f5a6734`.
- `manifest-before.json` records all 156 source hashes and all 282 input hashes,
  seven backend entrypoint lists, tool versions and mandatory ancestors.
- Memory/mount readiness polling observed clean committed 307938f after 5.124
  seconds, within the 110-second bound. At archive capture the moving checkout
  had advanced to bb1ae0a and Memory was dirty again; this is recorded, not hidden.
  Only committed 307938f archive bytes ran. No moving-source result is included.
- All archived inputs were unchanged after acceptance and after restoring the
  isolated diagnostic fixture. All 86 pre-existing owned files at 2647bcf remain
  byte-identical, including every earlier fixture and raw report.

## Exact separate cohorts

| Cohort | Pass / total | Fail |
| --- | ---: | ---: |
| Unchanged original43 | 36 / 43 | 7 |
| Original positive subset | 31 / 38 | 7 |
| Original rejection subset | 5 / 5 | 0 |
| Frozen original mount guards | 4 / 4 | 0 |
| Frozen required mount/overlay guards | 49 / 49 | 0 |
| Memory | 126 / 126 | 0 |
| Real initial capture (includes historical reader) | 93 / 95 | 2 |
| Real live-only, short native-temp replay | 94 / 94 | 0 |
| Mount | 209 / 209 | 0 |
| Readonly | 103 / 103 | 0 |
| Overlay | 184 / 184 | 0 |
| S3 | 221 / 221 | 0 |
| WebDAV | 526 / 526 | 0 |
| Shared conformance | 202 / 202 | 0 |
| S3 policy | 86 / 86 | 0 |
| Remote cancellation | 24 / 24 | 0 |
| Diagnostics | 8 / 8 | 0 |
| Required-names preflight matrix | 77 / 79 | 2 |
| Qualified-input diagnostic runtime only | 43 / 43 | 0 |

Every test cohort has zero skipped, todo and cancelled tests. Scoped original FS
types exit 0. Qualified diagnostic types exit 2 with exactly two TS2345 errors.
Overlapping cohorts must not be summed. The independent authority verifier's
76-test tree was excluded. No live adapter-stress aggregate was run at this
intermediate checkpoint; it belongs to the requested final replay.

## Seven original required workflows remain red

1. `REQUIRED s3 one-mount copy, target existing`
2. `REQUIRED s3 separate-clients copy, target existing`
3. `REQUIRED s3 separate-clients cross-mount mv, target existing`
4. `REQUIRED memory to-remote s3 copy, target existing`
5. `REQUIRED memory from-remote s3 copy, target existing`
6. `REQUIRED memory to-remote webdav copy, target existing`
7. `REQUIRED memory from-remote webdav copy, target existing`

Expected success remains unchanged. Six copies return typed FsError ENOTSUP,
syscall copyFile, cause `ENOTSUP: operation not supported`. The move exits 1 with
`mv: ENOTSUP: existing move destination lacks authoritative distinctness
'/left/source' -> '/right/target'` (exact escaped stderr in observations).
All seven preserve complete before/after bytes and namespaces. Their operation
traces contain only S3 listObjectsV2/headObject or WebDAV PROPFIND: no body GET,
PUT, COPY, MOVE or source removal. This is refusal before target effects, not
successful ordinary overwrite and not the earlier core EXDEV defect.

The current comparison seam exists. Arbitrary S3 forwarding Proxies lack the
provider binding; arbitrary WebDAV forwarding fetches do not qualify for the
Memory-to-provider disjoint-storage authority. Current WebDAV remote-to-remote
comparisons can use actual DAV resource IDs; passing those cases does not trust
arbitrary forwarding callbacks. Direct backend copy/rename and missing-target
mount workflows remain meaningful positives. Memory, wrapper-distinct paths,
shared backend mounts, separate Real adapters sharing a root and paired alias
controls also pass. Distinct client instances never establish disjoint storage.

## Diagnostic qualification is not original acceptance

Only isolated S3 inputs changed to createS3Transport(service,
service.capabilities), and WebDAV inputs to service.createFetch(), with the
necessary S3 factory import. See `diagnostic-qualified-input.diff` and both
complete fixture copies. All 30 assertion call sites are byte-identical; all 43
runtime tests pass (38 positives plus 5 rejection controls).

Diagnostic fixture SHA256:
`53061e040a1d54531670f5a2cfb9ad9eae1aa5d9afa155531572cd85c9dd9365`.
The unchanged helper parameter remains `typeof service` (MockS3Client), whereas
the factory returns S3Transport. Typechecking records TS2345 at (44,18) and
(44,44), missing mock-only fields. This capture stopped without changing that
annotation or adding a cast. It is not a type-valid replacement or approval to
replace the original acceptance fixture. Later approved diagnostic-only typing
correction must receive a new label and preserve these two errors.

## Preserved Real harness failures and matrix limits

The first Real run accidentally selected the historical metadata-review
classification reader, whose final-evidence.json was intentionally not archived;
its loader failed ENOENT. It also ran the Unix socket fixture under a deeply
nested TMPDIR: stat(socket) returned ENOENT instead of expected ENOTSUP.
Both original raw failures remain in `backend-real.stdout` and its JSON.

`real-native-recheck.mjs` re-extracted the exact same hash-checked archive,
excluded only that historical artifact reader, and used a newly owned short
native root `/tmp/sb-real-oefBqG`. All eight unchanged live Real entrypoints pass
94/94, with source/input stability checked before and after. This isolates a
scope/environment correction, not a product fix or an assertion waiver. The
first 93/95 result is not relabelled as 94/94; no other cohort was rerun.

The matrix retains the two remote rmdir gaps (S3 and WebDAV create/copy/append/
inspect/remove workflows). Both refuse unsafe empty-directory deletion with
ENOTSUP. Current 77/79 is not the historical original diagnostic 71/79; 8/8
diagnostics does not close that matrix. S3 non-atomic rename opt-in, no ABA or
snapshot guarantee, and unknown final-symlink/source deletion limits remain.

## Reproduction and cleanup

`checkpoint-307938f.mjs` records commands and refuses to overwrite this evidence
directory. Replay in an isolated checkout with a fresh owned evidence location,
or use the archived files and commands from each result JSON. Preserve the
original failures when reproducing the capture runner. For live Real, use the
recorded short-native-temp replay rather than its initial broad enumeration.
No runtime dependency was added. Node 22.22.2, tsx 4.23.12, TypeScript 5.9.3.

All 18 main commands closed without timeout or residual process group; the
Real-only replay also closed. Only this leaf's scratch directories and newly
created native root were removed. `leaf-process-cleanup.json` and the Real
recheck JSON record cleanup; owned status contains only this new runner and
evidence directory. No other worker's process, source, fixture or index was
modified. This checkpoint is intermediate evidence, not full FS integration
closure or a claim of 38/38 original positive compatibility.
