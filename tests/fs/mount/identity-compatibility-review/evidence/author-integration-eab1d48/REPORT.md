# Author combined-source integration: faithful forwarding

This is **AUTHOR integration evidence**, not Dirac's independent review or
acceptance. One committed snapshot ran the unchanged original fixture once:
**38/38 required positives + 5/5 controls = 43/43**. Original guards pass 4/4,
required guards pass 49/49, and scoped fixture/FS typechecking exits 0.
There are no retained failures, skipped, cancelled or todo tests in this run.

## Fixed inputs

- Source revision: `eab1d48a90456c1c2cdeb9289b32f1ed62429137` (HEAD at freeze).
- Required ancestors checked: core `0bee8e7`, S3 `91d5926` and `d49d9e5`,
  WebDAV `8c863cd`, Memory `d82cca9`, and contract `cd8b5c8`.
  Full commit IDs are recorded in `manifest-before.json`.
- Original43 fixture SHA256, unchanged:
  `9d11741fd9b37757046c1278fdaa00c734633bfd9a1fc58ae479415c2f5a6734`.
- Full source-set SHA256:
  `fc3269f23944309ee92ff8ecfb3cae12654d19bdb3d8e41d26523ab54be39066`.
- The 156 source files and 165 total inputs have individual hashes in both
  manifests. Each of the four command JSONs records full source hashes before
  and after; all match. Original4/required49 fixture bytes match source4fa.
- No factory qualification, helper typing correction, assertion change, source
  patch, new case or new API was applied. The original opaque S3 clients and
  manually forwarding WebDAV fetch callbacks ran unchanged.

FS and contracts were committed clean. Live archive README/format changes were
uncommitted and excluded: execution loaded only the pinned git archive, not the
moving checkout. Current Memory test alignment and all other workers' trees were
not selected. This is not a globally clean worktree or whole-product check.

## Results and former failures

| Cohort | Pass | Fail | Skip / cancel / todo |
| --- | ---: | ---: | --- |
| Original43 | 43/43 | 0 | 0 / 0 / 0 |
| Positive subset | 38/38 | 0 | 0 / 0 / 0 |
| Control subset | 5/5 | 0 | 0 / 0 / 0 |
| Original guards | 4/4 | 0 | 0 / 0 / 0 |
| Required guards | 49/49 | 0 | 0 / 0 / 0 |
| Scoped fixture/FS types | exit 0 | 0 diagnostics | not a test count |

All seven original positives that failed at b02bbe8 now pass the same exact
success and byte/namespace assertions:

1. `REQUIRED s3 one-mount copy, target existing`
2. `REQUIRED s3 separate-clients copy, target existing`
3. `REQUIRED s3 separate-clients cross-mount mv, target existing`
4. `REQUIRED memory to-remote s3 copy, target existing`
5. `REQUIRED memory from-remote s3 copy, target existing`
6. `REQUIRED memory to-remote webdav copy, target existing`
7. `REQUIRED memory from-remote webdav copy, target existing`

`original43.observations.json` preserves exact outcomes, ordered provider traces,
source/target bytes and namespace snapshots for every original case.
`former-seven.json` identifies the seven changes from the historical result.
The five original alias/default-limit controls also pass; refusal is not being
counted as a positive workflow success.

## Meaning and boundaries

The newly approved contract retains fresh provider query provenance and
filesystem/path/stat binding while allowing faithful opaque forwarding without
client/fetch/method-table eligibility fingerprints. The corresponding content
operations must use the resource the provider observation describes. Forwarding
mock metadata while redirecting writes elsewhere violates that semantic binding;
this run does not establish a sandbox against hostile host JavaScript.

Legitimate overlapping views still require actual alias protection. Generic SDKs,
copied/serialized metadata, real-provider binding, future public API design and
all broader provider guarantees remain outside this narrow execution. No
per-client disjoint token or broad trust flag is introduced. Dirac exclusively
owns `tests/fs/authority-trust-review/**` and its independent legitimate-overlap/
gateway review; this runner neither reads its fixtures into the archive nor runs,
edits, stages or claims its acceptance.

Historical original31/38, qualified38/38, both 307938f diagnostic type errors,
historical Real failures and all prior evidence remain untouched. This new
author-only 38/38 observation does not retroactively relabel them. No broad
backend, conformance, safety, matrix or qualified diagnostic suite was rerun.
The prior matrix77/79 and remote rmdir gaps remain open, not freshly measured.

## Reproduction, integrity and cleanup

`author-integration-eab1d48.mjs` is the bounded capture runner. Reproduce from
the immutable revision and the exact input paths in the manifest with existing
development tooling; no archive/source tree is duplicated in evidence. The
runner refuses to overwrite its evidence directory, so use an isolated checkout
and fresh owned output location. Commands and scoped type configuration are
recorded verbatim. Node 22.22.2; tsx 4.23.12; TypeScript 5.9.3. No dependency added.

Execution: 2026-08-27 02:32:22–02:32:24 UTC. Four child commands closed with no
timeout or residual group. The short native TMPDIR `/tmp/sb-author-pqVnPV` and
new owned extraction directory were removed; owned `.runs` is empty. Native
fixture-local temporary files existed only inside that extraction. No unowned
process, temporary path, source or index entry was touched. `cleanup.json`
records this leaf's PIDs and owned status. The explicit-path commit contains
only this new owned runner and evidence; no existing artifact is changed.
