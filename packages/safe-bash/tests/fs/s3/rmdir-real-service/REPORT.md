# S3 rmdir source-author handoff — August 27, 2026

**AUTHOR ONLY. Positive product rmdir is NOT IMPLEMENTED.** Root/Curie policy
clarification remains necessary. No production source, contract, export,
permission API, manifest, other adapter, independent verifier evidence, or
adapter-tools matrix was edited. No runtime dependency was added.

Harness/proposal commit: `329eb2722052e8ace0ec18a751f12c30ed87a25b`.
There is **no production-source commit**. `README.md` contains the precise
proposed snapshot-marker exception and required normative cross-references;
the proposal is repository evidence, not a temporary-file-only handoff.

## Contract decision

Current contract lines 8–21 require empty-directory removal with removal-time
emptiness, ENOTEMPTY on nonempty directories and namespace preservation on
failure. Deleting exactly a marker after an empty LIST preserves all children
but cannot enforce that requirement. A concurrent child keeps the logical
directory present after marker deletion. Reporting success would weaken the
postcondition; reporting ENOTEMPTY after deletion would break preservation.
No second listing or marker reinsertion repairs that atomically.

The separate read-only contract reviewer agrees. Root's safe-boundary relay
also confirmed the existing policy blocker while authorizing investigation of
the nonempty diagnostic discrepancy. That investigation found a pinned-provider
listing defect, not a product decoding/pagination defect. Production remains
unchanged, including the existing empty-directory refusal; this work does not
introduce blanket ENOTSUP as a substitute implementation.

## Frozen results and original failures

Final source HEAD: `25a892f0908c12c1d00846690167fb520fa0fe42`.
Final evidence: `evidence-1D1P9B/`, service `service-zfI7Y9/`.

| Separate cohort | Final result |
| --- | --- |
| Existing S3 rmdir tests | 19/19 |
| Other direct S3 regression tests | 269/269 |
| Existing HTTP unit tests | 69/69 |
| Readonly/mount/overlay rmdir tests | 36/36 |
| Existing required alias guards | 49/49 |
| Build / scoped strict types / actual npm pack / unpack | all exit 0 |
| Author actual-service observations | **19/20, overall runner exit 1** |
| Positive public product rmdir workflows | **0; still blocked** |

The 442 scoped node:test cases have zero failure/cancellation/skip/TODO. These
counts are not expanded by repeated runs. They are not a full current gate,
provider certification, independent verification, or superiority evidence.
Both root and S3 HTTP subpath factories are imported from the actual unpacked
package and asserted identical. The public Shell uses that same packed package,
not a private source import or rewritten export map. Public-consumer JavaScript
execution is not separately claimed as a TypeScript consumer compile.

All original cohorts are retained, not rebaselined:

| Evidence directory | Frozen source HEAD | Service observations |
| --- | --- | --- |
| `evidence-GScgVQ` | `ad837f1a650473eeefed3336558f37aed9bce352` | 1/2; stop at harness diagnostic assertion |
| `evidence-EK5WvL` | same `ad837f1a650473eeefed3336558f37aed9bce352` | 5/6; stop at nonempty errno mismatch |
| `evidence-Xyjrmo` | `9ba94f5d000eb846f5be51c2405448904047917c` | 17/18; full then-defined cohort, mismatch retained |
| `evidence-1D1P9B` | `25a892f0908c12c1d00846690167fb520fa0fe42` | 19/20; adds native isolation and default-page control |

Unreached observations in the first two runs are not passes. The first harness
expected `/not supported/i`; actual stderr was exactly
`rmdir: ENOTSUP: S3 object deletion cannot atomically require an empty directory prefix, rmdir '/empty'`
followed by newline. The assertion was corrected to this exact string, not
relaxed generally. Its original script is preserved in
`evidence-GScgVQ/original-author-inputs.json`. Later input snapshots accompany
each run. The original `/work` ENOTEMPTY assertion remains unchanged and FAILS.
Adding failure accumulation allows subsequent independent cases to execute; it
does not suppress the final nonzero exit.

Root's original matrix **77/79** remains 77/79, including its frozen `debb29e`
measurement and separately owned `9ba94f5` evidence. No matrix was rerun here.
No unsupported-rmdir waiver or inference of closure is made.

## Isolated nonempty mismatch: pinned provider, not parser

The fixture uses ordinary public Shell mkdir and writes `payload` into
`author/work/file`; independently signed native GET confirms the zero-byte
`author/work/` marker and exact child bytes before and after testing.

Final native requests 18–23 query the SAME bucket/prefix using MaxKeys 1, 2 and
1000, each both with and without delimiter `/`:

- MaxKeys=1: HTTP200, only `author/work/`, IsTruncated=false, no continuation
  token, despite the independently confirmed `author/work/file`.
- MaxKeys=2 and 1000: HTTP200, both marker and child, IsTruncated=false.
- With product pageSize=1, actual rmdir follows the service's claimed complete
  marker-only list and returns ENOTSUP, not required ENOTEMPTY. This is the
  retained failing assertion. Product and wire traces record no destructive
  request for this operation; marker and child remain unchanged.
- Separate default-page-size public adapter control returns typed ENOTEMPTY
  and preserves both objects. It is not a replacement of the failing profile.

`service-zfI7Y9/wire-18.body` through `wire-23.body`, their traces/headers and
`requests.json` preserve independent native responses. `product-errors.json`
preserves exact errno/path/syscall/messages. The product did not invent the
false completion flag or lose a continuation token. Removing delimiter alone
does not fix the issue. No endpoint-name inference, hardcoded page-size change
or unverified transport feature was added. This result is specific to the pin
and fixture; it does not diagnose the upstream implementation's internal cause
or establish that any larger page size is universally safe.

## Supported observations and refusals

The measured service is MinIO Community RELEASE.2025-09-07T16-13-09Z,
source `07c3a429bfed433e49018cb0f78a52145d4bedeb`, Darwin ARM64; official binary
SHA256 `7c3b3039b76e55a1b80935848ed83998d5e8d317374f87851f46a019ff5c0aa4`.
It is a pinned historical test service, not a latest/security recommendation.
The explicit profile selects form LIST decoding, verified PUT, disabled native
COPY, and **conditional DELETE=false** throughout.

- Packed Shell mkdir/write/read succeeds and independent GET verifies effects.
- Packed Shell empty rmdir and rm -d exit 1 with the exact preserved unsupported
  diagnostic; the marker remains. Adapter direct empty removal returns ENOTSUP.
- Files and trailing-slash file operands return ENOTDIR; missing returns ENOENT;
  root returns EBUSY; implicit directories and nested markers return ENOTEMPTY.
  Default-page explicit nonempty returns ENOTEMPTY; pageSize=1 failure is above.
- Readonly wrapper and adapter readonly return EROFS; mounted root returns
  EBUSY; mounted empty path forwards ENOTSUP. Original overlay tests also pass.
- Wrong synthetic credentials produce EACCES. Pre-abort issues zero requests;
  abort after a real LIST response produces ECANCELED and leaves the marker.
- A trusted forwarding transport injects a real child after a complete LIST:
  current rmdir returns ENOTSUP and preserves both marker and child. No malicious
  callback/sandbox assumption was invented.

Native primitive probes are NOT product rmdir passes:

- Quiescent exact-marker DELETE returns 204 and removes that directory view.
- After an empty LIST, native insertion of a byte child, nested marker and
  nested byte child followed by exact-marker DELETE preserves all three
  descendants. The marker disappears but public stat still sees a directory:
  a concrete snapshot-success postcondition counterexample.
- Removing/recreating the same empty marker with changed metadata yields the
  same ETag. An unconditional DELETE then removes the replacement: marker ABA
  is not protected. An object ETag alone would not predicate prefix emptiness.
- Stale If-Match DELETE returns 204 and deletes the test object, rather than
  the 412 required to verify that guard. Conditional DELETE stays false.
- Wrong-signature marker DELETE returns 403 and preserves the marker.

There are 68 independent native wire requests in the final run; those are not
68 tests. All product trace cohorts record zero DELETE requests. Deliberate
native marker/guard-test deletions are separately recorded and never recursively
delete descendants. No DeleteObjects request is issued.

## Provenance and cleanup

Each run freezes committed files into an owned snapshot, checks live bytes
against the selected commit, then builds and packs the real package there.
Input hashes, exact command exits, TAP, raw service logs, wire payloads and
response headers are retained. All four runs have the same source-set hash:
`be9e84d5da26a2699e0a4286910b83cad067970abbfda9506581cb0c170e0ae5`
(SHA256 of JSON.stringify of sorted provenance input entries under `src/`).
Every final audit reports no frozen or live input change and an empty S3 source
patch. Unrelated concurrent HEAD movement is separately recorded; none changes
the measured inputs. S3 source and the rmdir contract also match supplied
`debb29ead94ae387f359d9d04b333ee4380f88d6` at final author inspection.

Final tarball SHA256:
`1d33ca77c0ffd5f431d1c2709b7c322c65f8654fa6649389b1c440673a45d99d`.
Its real package manifest has zero runtime dependencies. Tarballs/build trees
are not retained; reproduction uses the recorded commit, tooling and harness.
`SHA256SUMS` seals all retained files except the seal itself.

The existing independent native signer/service harness is reused, not rewritten.
Exactly two output-prefix substitutions relocate its temporary service/download
paths under this owned directory; original and relocated hashes are disclosed.
Service requests use synthetic credentials and owned fresh bucket/data roots on
loopback only. No external bucket or private checkout was accessed. The official
binary download is verified by exact size, SHA256 and embedded release/commit.

All four owned MinIO children exited 0. Their owned home/data and every snapshot,
consumer, npm cache and downloaded binary were removed in finally blocks, even
after assertion failures. Each run has `cleanup.json` plus service shutdown
evidence. Raw evidence remains; other workers' temporary files are untouched.
Only source-author work is claimed. Root's final independent verifier remains
separate, and the user's positive-rmdir requirement remains unmet pending policy.

Code/document whitespace checks pass. The unrestricted staged whitespace check
flags raw HTTP CRLF, final header terminators and MinIO's original stderr
trailing spaces. Those wire/service evidence bytes are deliberately preserved,
not formatted or normalized. `validation.json` records this separate result.
