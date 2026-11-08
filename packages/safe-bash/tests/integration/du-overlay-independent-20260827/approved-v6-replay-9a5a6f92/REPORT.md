# Independent frozen DU + Overlay v6 replay report

Date: 2026-08-27

Candidate: `9a5a6f922beb1bc6ba84a0cd32ea7a12f8ce985d`

Freeze: `cea13e21b26e3bf85c60e56e7a846e28b6f68720`

Freeze tree: `b61988ff4a23a6a90d5ffa15149b314af0ae6c63`

Pre-replay audit commit: `3b5a1b18`

## Decision

**V6 REPLAY REJECTED AS A FROZEN-VERIFIER FAILURE.** The exact
self-materializing replay exited 1 during the fresh source suite, which passed
35 of 40 records. Four failures are caused by full-stat snapshot observers that
still contaminate non-metadata holdout comparisons with `atimeMs`; the fifth is
a real-file-atime mutant control that issued its intended content read but
observed no atime delta. These are material frozen assertion/sensitivity defects
under the root-approved directory-atime policy. They are not evidence of a
candidate mutation, content read, copy-up, or non-atime metadata change.

The replay therefore did not reach npm dry-run/pack, installed/moved package
execution, strict moved-consumer types/runtime, scoped regressions, moved load
attestation and negatives, or the 16 native GNU rows. This run provides neither
candidate acceptance nor candidate rejection. A newly versioned freeze is
required; the v6 bytes and failed output were not changed or retried through an
invented path.

The pre-replay audit correctly authenticated the objects and four process/pack
protocol corrections, but it incorrectly concluded that all assertion windows
were observer-isolated. Actual execution exposed that four later holdout helpers
still use `backingSnapshots()` equality rather than the lstat-only measured
policy. This report supersedes that pre-execution judgment without rewriting
the committed checkpoint.

## Exact execution and reached boundary

The command used the documented CLI with the full freeze and candidate IDs,
the new `approved-v6-replay-9a5a6f92/replay-001` result directory, and the pinned
GNU 9.7 binary. Bootstrap materialized the committed freeze, verified all 20
files, and launched that extracted `replay.mjs`. The materialized child was not
the mutable HEAD runner or mutable HEAD product source.

Reached steps:

- exact freeze and candidate commit resolution: pass;
- 20-file materialized freeze precheck: pass;
- timeout/grandchild process-group control: pass;
- 249-path selected candidate admission/archive/extraction: pass;
- exact candidate source build: pass, 788 emitted files;
- original source suite: 24/24 pass (17 holdouts, seven controls);
- fresh source suite: 35/40 pass, then bounded ordinary exit 1;
- materialized freeze failure-path postcheck: pass;
- bootstrap parent post-child frozen-tree check: pass.

Not reached and receiving no pass credit:

- scoped 128-regression selection;
- npm pack dry run, actual npm archive, dependency admission/install, physical
  relocation, complete package/install comparison;
- strict NodeNext moved consumer and moved runtime;
- source-vs-moved original/fresh suite projections and nextLoad attestation;
- wrong-root/source-fallback, missing-DU, restored-cleanup, and declaration
  controls;
- all 16 native GNU environment rows.

The in-memory synthetic AGENTS and invalid-packlist controls did execute in the
bootstrap before materialization and rejected before writes. The actual npm
pack guard was not reached. The actual process timeout control did execute:
root/group `14473` timed out after 1.5 seconds, received TERM then KILL, reported
grandchild `14474`, and left root PID, owned group, and grandchild absent.

## Fresh-suite failure analysis

Raw fresh stdout is 1,003,923 bytes, SHA-256
`d4855b54732c332ad622733c018929a3dd4d9a43473a7a6b114017cc696fc157`.
Raw stderr is 2,594 bytes, SHA-256
`21cea008d3c583b400f7851285a6347d8eb9d9e6e293bd8b52d7221556a6e2e0`.
Both are retained as `all-processes-raw/055.*`; all 40 result objects and all
before/after stats/calls are intact.

The failures are:

| ID | Frozen failed check | Raw fact | Classification |
| --- | --- | --- | --- |
| V5-020 | retry leaves backing unchanged | 13 compared deltas, all `atimeMs`; equality becomes true after removing only atime | full-stat snapshot observer contamination |
| V5-024 | file atime is rejected while listed-directory atime remains authorized | intended real `readFile /file.bin` and `readdir /` calls recorded, but zero stat deltas | sensitivity control did not trigger |
| V5-029 | backing unchanged after mid-abort | 12 compared deltas, all `atimeMs`; equality becomes true after removing only atime | full-stat snapshot observer contamination |
| V5-030 | queued readdir metadata phase leaves backing unchanged | 13 compared deltas, all `atimeMs`; equality becomes true after removing only atime | full-stat snapshot observer contamination |
| V5-031 | queued DU metadata phase leaves backing unchanged | three directory `atimeMs` deltas; equality becomes true after removing only atime | full-stat equality rejects allowed listing effects |

The complete per-layer/path/value delta lists are in `FAILURE_ANALYSIS.json` and
the raw suite JSON. V5-020/029/030/031 compare full snapshots made by a helper
that recursively calls both `readdir` and `readFile`. Those observations are not
the lstat-only pre/post measured window required by policy. The file-atime
changes in those comparisons therefore cannot be assigned to the product
action, and authorized directory listing atime is not filtered. All non-atime
fields, bytes, and entries in those four exact comparisons remain equal.

V5-024 is independently disqualifying as a verifier sensitivity failure. Its
action log proves the intended content read occurred, but its lstat pre/post
objects are identical. V5-021 real directory listing, V5-022 real lstat, and
V5-023 observer-only file read passed; that does not turn V5-024's absent delta
into a pass.

## Root-approved atime and DU contract results

The 19 correctly isolated direct/read-only/mount composition metadata and DU
rows all passed. Their complete action-window evidence contains 17 observed
deltas total; every delta is directory `atimeMs` on an exact layer/path that the
action really listed. Every unauthorized-delta list is empty. Every row records
zero mutation calls, zero content reads, and zero unknown calls, with unchanged
bytes and entry sets and intact pending state. Direct stat/lstat rows have no
deltas. Full lists are retained in `FAILURE_ANALYSIS.json` under
`measuredPolicyRows.rows[*].statDeltas`.

This is evidence for those 19 source-build records only. It is not full-stat
purity, and it cannot substitute for a passing whole 40-record freeze or moved
package replay.

The candidate-side 1,500-byte literal environment table also ran before the
stop and passed 16/16. It proves, in this source fixture, the frozen precedence
and explicit-option expectations for `DU_BLOCK_SIZE`, `BLOCK_SIZE`, and
`BLOCKSIZE`: selected invalid/empty values use default units without lower-key
lookup, valid selected values use one 3,072-byte unit, and invalid explicit
`-B` fails with zero filesystem calls. These 16 rows are one fresh-suite record.
No native row ran, so there is no new native outcome or native cwd evidence.

## Source, build, archive, and absent package provenance

The admitted candidate archive is 2,447,360 bytes, SHA-256
`b6c8055a335f5a3e316501267d5ed4590a765cf380cc44eec9d0e84774321381`.
Its 249 source inputs total 2,228,559 bytes; the canonical inventory SHA-256 is
`2a6643eba131b08171d548eda8014ce67c1d125d92b949f4e1b93fc5d9e192ed`.
After the failure, excluding generated `dist`, the same 249 paths, bytes, and
hashes matched the pre-build inventory exactly. No selected or scratch
`AGENTS.md` existed.

The successful build emitted 788 files totaling 3,739,166 bytes with canonical
inventory SHA-256
`02606aa248b4984a7be4491c0e6e3d3d0cb729638fc350ed1a9ee3892c7d7c91`.
The whole built source tree had 1,037 files totaling 5,967,725 bytes and
inventory SHA-256
`f5f86c2248afe6c8e7a6357357f47d98ee4254f878db0640309049a4c658bbde`.
The complete retained work tree including `candidate.tar` had 1,038 files,
8,415,085 bytes, inventory SHA-256
`2ddbe581d7537e694d5981f02e8c6607c0acac50059f4e95b414dbbe27334fdd`.
Every per-file path/size/SHA-256 is sealed in `SCRATCH_INVENTORY.json`.

There is no npm package tar hash, installed-package hash, or moved-package hash:
those objects were never created. This absence is not reported as a pass.

Observed tools were Node v22.22.2 (binary SHA-256
`5c899797c4eb8f1db5563eea56538342ddb3e9276ee1b04a5a1f0f1023d2b011`),
npm 10.9.7 (CLI SHA-256
`8e5f6f3429f8cdbe693cdc29904e9d5a7b127a494bd15c804bd54c7403bfcbe7`),
TypeScript 5.9.3 (launcher SHA-256
`8d5fa5bd883fec0979fc2004f1fe1d99aef40570155d550eadc0b03b55513bf0`),
and tsx 4.23.12 (`package.json` SHA-256
`96aee9fd252d0cc31f3c01468250961f5b338c797bc208700d7db926450c7659`).
The GNU oracle remained the frozen realpath/version and SHA-256
`f1df033deed07d208d80128568404c1043b283c59f294164f1240789bfadcf2b`.

## Frozen bytes, closure, cleanup, and preservation

The materialized 20-file inventory SHA-256 was
`3c8fff0fc33a0ada3104d2849b503b1c9833174a112ccbc41ed7dc50ab1d3d3e`
before cases, in the materialized failure `finally`, and in the bootstrap parent
after the child. All three checks verify exact path count, size, SHA-256, and
Git blob with no new/deleted entry. A bounded independent post-run verifier also
returned the exact freeze tree/manifest and the live frozen directory still
matches all 20 committed bytes.

The materialized manager retained raw stdout/stderr/status for 55 processes;
the bootstrap retained 50. Every recorded root PID and process group is closed.
Post-run probes found none of the 105 roots/groups or timeout grandchild alive.
The three post-run validation processes also closed.

Because the exact frozen runner retains scratch on failure, it recorded the
work and bootstrap paths as retained. Before deletion, this verifier sealed all
1,038 work files and all 21 bootstrap files, with the bootstrap inventory
SHA-256
`6686a83cb88e9888a5d79dd3113b1bb9a2f28765f85537ace8f44b5caa312eb3`.
It then removed those two exact task-owned trees and the independent audit
scratch; actual post-cleanup probes found all three absent. Raw process and
failure evidence remains committed outside scratch.

No `AGENTS.md` was created, copied, edited, or found in owned results. Repository
AGENTS status is empty, no process history invokes the unsafe migration audit,
and the earlier 15-copy incident remains historical. The original 867,078-byte
failure stdout and its stderr/status remain byte-identical, as do the prior
candidate, correction-v4, independent, and canonical-migration reports. The
foreign cached-index SHA-256 was the empty-byte hash both before the failed
suite and during post-run validation; unrelated worktree changes were untouched.

## Permanent qualifications

The old 22-failure/10-pass capture and old33 qualification remain unchanged.
The unavailable refined-v2 bytes and v2-to-v3 exact delta remain permanently
unproved. V6 does not repair that provenance gap.

This failed partial replay establishes no O060 behavior, three-operand native
ordering result, native parity, GNU/Linux behavior, public/default DU wiring,
deployed-provider behavior, whole gate, superiority, or completion claim.
