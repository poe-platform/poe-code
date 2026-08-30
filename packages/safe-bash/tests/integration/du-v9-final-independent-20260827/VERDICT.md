# V9 independent bounded verdict: REJECTED

Reviewer: **V9-Final-Independent-20260827**, not Heisenberg. Date: 2026-08-27.
Exactly one actual replay ran, from 20:55:12.268Z to 20:55:23.861Z (11.592 s).
It settled with exit 1, without timeout. No retry, product repair, new fixture
version, native diagnostic repetition, subagent, commit or branch change occurred.

## Exact bindings and authentication

- Product: `9a5a6f922beb1bc6ba84a0cd32ea7a12f8ce985d`; product tree
  `62c1b2f2784ca465b17d4b15a5736c42b8bdcf2d`. No DU root/default registration.
- V9 freeze: `1b2ddea9e38b25cc91134a2f35a318e27f4d7c29`; fixture tree
  `5746d585be79a0c187d1b19a8e2f58b98c3dc433`.
- Manifest SHA-256:
  `474a95bd160636cdbabe03943a0a84aaaeb56d04ab87d25915bb1ac8cbdf9fa2`.
- Exact inventory: **23 fixture files / 249 candidate paths / 16 environment rows**.
- V8 predecessor: `ae0f8b3f4f927b06718fc51e176ca7a54b517364`, all 22 files
  authenticated. Diagnosis: `a852a471b65b70b8f19e2915d316e3c12847cabb`;
  its declared raw JSON blob/hash and commit tree were authenticated, not rerun.
- `PRE.json` and `POST.json` match for both complete frozen trees, every selected
  candidate byte, tooling identities, oracle and reviewer execution scripts.
  Both frozen-tree inventories detect new/deleted entries, not only altered
  original paths. The index fingerprint remained unchanged.
- Node v22.22.2, npm 10.9.7, TypeScript 5.9.3 matched the freeze. PRE also binds
  tsx 4.23.12, esbuild 0.28.2, type packages, npm/tool package trees, Node/Git/tar
  executable bytes, and the supervisor before importing it. Supervisor SHA-256:
  `f322101cfaa23612287cd728f52f50c672a19325eda00b69d8280827d83cfa5d`.
- GNU du 9.7 oracle path/bytes/version matched SHA-256
  `f1df033deed07d208d80128568404c1043b283c59f294164f1240789bfadcf2b`.
  Only version identity was executed; no native semantic row ran.

## Correction review and exact blocker

The initial two-body review found no relaxation of product metadata policy:
V5-023 records real read-atime behavior without a universal update assumption;
V5-024 independently detects a content read and actual controlled host file-atime
perturbation, retaining unauthorized companion deltas. Both printed `ok` in the
one replay. The executable prefix/suffix outside the two bodies is byte-identical
to V8; other executable edits are path routing only.

**Nevertheless, the correction as a complete frozen executable is rejected.**
V5-024's new title begins `content-read and deterministic file-atime`, whereas
the unchanged `record()` classifier at frozen `harness/verify-v5.mjs:241` only
recognizes `atime field scope` (or `real ` / `observer-only file read`) as observer
policy lineage. The renamed control is therefore counted as historical.

After all 40 cases printed `ok`, line 1153 asserted **32 !== 31** historical
records. The exact raw-name/classifier partition is **32 historical / 2 lifecycle
/ 6 observer-policy**, not the frozen required **31 / 2 / 7**. The first assertion
terminated the process before either remaining lineage assertion or final JSON
output. Fresh stdout is exactly **0 bytes**. This is a frozen-harness bookkeeping
defect caused by the title change, not an established candidate bug or renewed
atime-prerequisite failure. The initial review missed this title/classifier
coupling; the actual replay exposed it. No assertion was relaxed or bypassed.

Actionable blocker: the frozen-fixture owner must reconcile that renamed control
with the declared lineage partition and preserve this failure before the root can
authorize further work. This reviewer changed neither fixture nor product and
does not authorize or perform another replay.

## Actual counts, without substituting inherited observations

| Phase | Actual bounded observation |
| --- | --- |
| Exact candidate build | Exit 0; 249 selected inputs match Git before/after, including no new non-dist inputs |
| Original source | **24/24**, 0 failed: 17 holdouts, 7 controls |
| Fresh source | **40 raw `ok` markers**, 0 `not ok`; process exit 1; no final summary; **not an accepted 40/40 suite** |
| Metadata/DU windows | **19/19 `ok` markers**; checks include zero unauthorized deltas; detailed stat/delta JSON not emitted |
| Candidate environment | Aggregate `ok`; all **16/16 row checks inferred from the unchanged every-row assertion**; individual raw row payloads not emitted |
| Corrected timestamp controls | V5-023 and V5-024 each `ok`; actual pre/post stat payloads not emitted |
| Lifecycle/abort/queue cases | Their individual `ok` markers are preserved among the 40, with child process settlement |

**Exact authorized-directory-atime delta count and exact unauthorized-delta
count are unavailable in fresh raw output.** The successful checks imply no
detected unauthorized delta, but the lost JSON cannot be reconstructed by
guessing. In particular, do not copy V8's 19 allowed/0 unauthorized counts into
this run. All 40 case names and the deterministic lineage derivation are retained
in `RAW_COUNTS.json`; raw fresh stderr is `fresh-source.stderr.data`.

Intentional negative controls are separate from the unexpected suite failure:

- Original source: 3/3 behavior-mutant detections, included in its 7 controls
  (the other 4 are positive/strict-option controls).
- Fresh source: 7/7 mutant-detection `ok` markers, V5-024/025/026/027/037/038/039;
  these are included in the 40, not additional successful product cases.
- AGENTS admission: rejected, zero writes, forbidden path never created.
- Invalid packlist admission: rejected, zero archive creations/writes/extractions.
- Timeout/grandchild control: intentionally timed out; root/group and actual
  grandchild PID 49436 were gone. This expected timeout is not the suite failure.

## Unexecuted stages and identity limits

All downstream actual stages stopped: scoped DU/Overlay regressions (**0/128**),
npm dry-run/pack/unpack and actual packlist admission, dependency admission/install/
move, strict moved consumer types/runtime, moved original (**0/24**) and fresh
(**0/40**) suites, package `nextLoad` attestation, wrong-root/source-fallback,
missing-DU, restored-cleanup and semantic-declaration controls, and native
environment semantics (**0/16**). No pack/install/nextLoad acceptance is claimed.

Source execution argv binds the exact Git archive, never live HEAD or a hidden
overlay. PRE/POST candidate input inventories match; eight built module disk
identities are recorded in `source-built-module-disk-identities.json`. These are
post-settlement disk hashes, **not** emitted fresh-suite or `nextLoad` attestations.
Package and load identities that require unexecuted stages remain unproved.

## Settlement, preservation and ownership

All actual case awaits reached their `record()` calls before the final assertion.
The frozen managers recorded **56 bootstrap + 61 materialized = 117** closed
root processes/groups. The independent outer supervisor adds one: **118/118**
replay roots/groups absent on an independent post-settlement check; the timeout
grandchild was also independently absent. The archival helper's one later tar
process/group settled and closed separately. No replay/child process remains.

Failure-path frozen checks passed on the complete materialized 23-file tree.
The failure procedure initially retained scratch; this reviewer then preserved
all **1,132 regular files** in `retained-scratch.tar.data`, verified every archived
payload against its pre-archive SHA-256, and removed exactly the bootstrap,
candidate and redirected temporary roots. All three were then **ENOENT**.
Archive: 11,347,968 bytes, SHA-256
`ed232b29d3800bfa27d600437e09c143f00b0b3d70f3a03988622319c640d2af`.
There are zero loose new `.ts`/`.mts` files and zero AGENTS files under this owned
directory. Immutable source/consumer TypeScript exists only inside data archives.
All reviewer outputs, caches, extraction/build work and archival work stayed in
this directory; no product/root/private paths or original evidence were written.

Two reviewer-helper errors are disclosed separately: PRE tooling inventory first
rejected npm's internal symlink representation; the post-settlement selector first
matched a Git read instead of Node execution. Both stopped before their evidence
writes, were corrected locally, and caused **no actual replay or case retry**.
Raw protocol failures remain unchanged. No staging/commit was performed, following
the explicit current no-commit instruction over the general atomic-commit rule.

## Permanent bounded qualifications

V8's 24/24 original, 38/40 fresh, 16/16 environment, 19 metadata windows and 19
allowed/0 unauthorized deltas remain inherited history, not this run. Its failed
preconditions and neutral-host atime publication remain preserved; the actor is
unknown. Original first-red controls, twelve fix closures, all V1-V8 failures and
the diagnosis were not rerun or rewritten. Unrecoverable V2-V3 delta is permanently
unproved. O060 duplicate operands remain deferred/profile-gap/deterministic-ordering.

Directory-atime listing effects remain explicitly allowed and recorded by policy,
not full-stat purity. No explicit mutation, content read, copy-up, backing byte/
entry change, file-atime change or other stat-field change is authorized in product
metadata/DU windows. Selected invalid/empty DU_BLOCK_SIZE/BLOCK_SIZE/BLOCKSIZE
defaults without lower-priority fallback; CLI `-B` remains strict.

This rejection supplies **no whole-gate, public/default DU, full-native,
GNU/Linux, deployed-provider, superiority, 72-hour-work or completion claim**.
The root decides any initial DU integration; this bounded replay is blocked.
