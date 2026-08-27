# Final narrow independent replay — August 27, 2026

## Result

**79/79 pass on pinned `eb4a24266a868257f0fdfd8a9ffaf2d57c24719a`.**
Scoped TypeScript exits 0. Tests run with `--unhandled-rejections=strict`;
there are zero failures, skips, cancellations or TODOs. This closes the two
specific late-authority holdouts in the unchanged independent cohort, not the
original compatibility gate or whole-product acceptance.

| Immutable checkpoint | Source revision | Pass / total | Failed | Scoped types |
| --- | --- | --- | --- | --- |
| Before: `committed-qualified-79`, committed in `bb1ae0a` | `307938f17db2714db9debc451f935e3134e2660e` | 77/79 | 2 | 0 |
| After: `late-authority-final-79` | `eb4a24266a868257f0fdfd8a9ffaf2d57c24719a` | 79/79 | 0 | 0 |

The after revision contains approved contract `5076b32`, core `0bee8e7`,
Memory correction `292689149ae75ff7fa8a2859d65b3a91c265681f`, and S3 correction
`eb4a24266a868257f0fdfd8a9ffaf2d57c24719a`. Ancestry was checked before execution.
The S3 final handoff arrived within the single bounded 120-second wait, with
clean S3 source. No older source or moving-worktree result substitutes for this
acceptance run.

## Exact holdout behavior

Memory and S3 late explicit `compareEntry` callbacks now each run exactly once
for public comparison and exactly once for the separate mounted-copy operation.
Both operations report typed EACCES. The unchanged tests assert exact source
**and target** byte preservation. The WebDAV control retains the same behavior.
Before the fixes, Memory/S3 invoked those callbacks zero times, returned distinct,
and overwrote the target; that raw 77/79 evidence remains untouched.

All prior operation-override preservation guards, harmless/explicit-authority
positive controls, protocol checks, wrapper resolution checks and five core
ordering cases retain their results. In particular, the unchanged S3 genuine
HEAD/Memory-IO regression stays green, `cp -P` preserves the unscoped aliased
source symlink, and EXDEV hardlink-alias `mv` retains status 1 without copying
or deleting either name. No test case, expectation, fixture or runner was edited.

## Immutable inputs and source hashes

All **393 files** tracked in this subtree at `bb1ae0a` were verified against their
Git blobs before and after replay, including every historical report, raw capture,
test and the `committed-wrapper-s3-47` baseline. The after manifest's complete
executable-input hash map equals the before manifest's map, byte for byte.
`CURRENT.md` remains the historical 77/79 report; this new report records closure.

`evidence/late-authority-final-integrity.json` records both complete 160-entry
source/input SHA256 maps, their differences, all historical file hashes, required
commit ancestry, and the final S3 handoff with its hash. Separate whole-source
worktree observations before/after show no changes during replay; those reads
were **not acceptance inputs**. The actual acceptance input is `git archive` of
the pinned revision. Only these captured source paths differ from the before run:

| Path | After SHA256 |
| --- | --- |
| `src/fs/memory/index.ts` | `57a6148aec90c7a1db058e59bd2586e7c162c74498309e7173443096cb8906ad` |
| `src/fs/s3/authority.ts` | `102a8ada61020ff65d3617cdd60fca350bff3e99f287fc0696ece04aac32b229` |
| `src/fs/s3/filesystem.ts` | `97f91913c3b2a9916218776d286eeaf25928d3aebbe3df60f0bf2d24d1635f6f` |
| `src/fs/s3/COMPARISON.md` | `909ccdae411009d4fd1566a4ac79d8aaeac7457b1f5735843b9e9a93ab908aca` |

All other captured sources and inputs, including the common helper, WebDAV,
qualified callback dependencies and core source, match the before snapshot.
Core SHA256 remains
`393ea36b78c2cc142633c0eb631bf4d316767b3992c0d5f0724135ca4f01403a`,
equal to `0bee8e7:src/commands/filesystem.ts`.

## Evidence identifiers

- Before manifest SHA256:
  `52c819e21e3fd01da907b7d718815317f9625fac0e4b7a841011ea7eaa957471`.
- After manifest, `evidence/late-authority-final-79/manifest.json`, SHA256:
  `4f838bf424504e1a80da591421eaef27318b3526ff8f1ee7ff43486edab02d3e`.
- After source archive SHA256:
  `11b3eb51ce33c4d75d8e99ce97ba3ffbd76b7b1349542c7e9ee1875657100a3a`.
- Before/after integrity record SHA256:
  `3021e2f2df37b725c85bbaae0dd932a6c2ede9cd4cc883fb1620395ced221e92`.

The capture contains raw TAP, typed-check output, decoded observations and frozen
input files. All 17 manifest-listed artifacts were rehashed successfully. Capture
ran August 27, 2026, 01:47:38.322–01:47:40.765 UTC, using Node v22.22.2,
tsx 4.23.12 and TypeScript 5.9.3.

Reproduce with a fresh label using the unchanged runner:

```sh
node tests/fs/mount/identity-authority-review/implementation/capture.mjs eb4a24266a868257f0fdfd8a9ffaf2d57c24719a new-replay-label
```

## Remaining limits and stop boundary

This is only the unchanged 79-case authority cohort. The original 43 compatibility
cases, required 38 positives, 53 guard cohort, and full filesystem suites belong
to other verifiers and were not replayed, modified or waived here. Qualified
fixture success does not establish arbitrary opaque-provider disjointness, live
S3/WebDAV interoperability, broad permission enforcement, or universal protocol
support. Unknown overlap must still remain unknown.

Comparison is not a lease, snapshot, transaction, ABA defense or general race
guarantee. Generic source deletion is not incarnation-conditional; cross-backend
move remains non-atomic and failed publication may leave partial target bytes.
No new feature, backend, case or public API is introduced by this replay.

The bounded wait and replay processes have exited; no leaf-launched process
remains. The owned scratch directory is empty. This checkpoint stops here for
root integration, with no continued watching or further test expansion.
