# Independent CORE event-writer delta review — SOURCE ACCEPT / PURE HOLD

Date: 2026-08-29. Direct independent review, no subagents. Owned publication root:
`tests/compatibility/bash-ere-core-writer-independent-20260829/`.

## Decision

**SOURCE ACCEPT**, narrowly for the v7 event-file writer/finalizer integration
and the conditional logical-bound derivation. **PURE HOLD**: the independent
author-control replay is 11 PASS / 1 unqualified reviewer-harness failure, not
12 qualified passes. All eight separately authored novel PURE groups pass.
No author/product defect is established by the replay failure. No actual
runtime, fresh layout, guard, transport, private-provider or ROOT release is
accepted here.

The author controls execute unchanged inside a VM, while their writer/finalizer
imports are module namespaces from the main realm. C09 compares a main-realm
secondary-reason array against a VM-realm expected array using strict deep
equality. This reviewer realm mismatch invalidates that replay result; retain
the exact diagnostic in `AUTHOR-REPLAY.json`. N06 independently checks every
cleanup attempt, terminal-write failure, close failure and audit failure in one
realm and passes, but does not silently turn C09 into a qualified replay pass.
The two-helper ceiling is exhausted; no third helper or hidden retry was used.
A corrected, separately authorized replay is needed to lift PURE HOLD.

## Identity and scope

- Source/preseal: `e33b99af9fbec345b4f5a76d50f627c3d4d9f73a`.
- Author evidence: `d40efe4068545ecff91cfb4051806dc0417427da`.
- Exact v7 execution-seal SHA256 authenticated:
  `0efb8f129c77f02a119548f9308eca39ad70ca73c5fb548c1fa9918b757326f2`.
- `AUTHOR-DIFF.txt` is the empty scoped `git diff` against that evidence commit
  for the entire author v7 subtree. `AUDIT.json` independently hashes each
  immediate regular v7 file and authenticates all three frozen layout manifests.
- New cell and dispatcher hashes match `BINDING-RECIPE.json`. The CASES-v4
  definition bytes independently match
  `278f9e51ab2eb96f0bae7564b1357ee9424166e475af10d1e5cb27b9a45fb7fb`.
- Earlier review `747da3ec5de062bd2929076d2d4fcec19fbe1f7b` remains inherited
  evidence: 70 definitions, 210 cells / three layouts, 48 private assets,
  30 PURE controls and 18 owner records. Its eight novel groups remain
  unqualified because of the earlier reviewer newline bug; they are not
  rescored by this review's differently named N01–N08 groups.
- Frozen e013/da4e/full1002 identities and package
  `4f90df04dba998f184473254bb450f9e085b9fc9d5994dc91a21a7ccf1d1d66e`
  remain prior evidence/binding context, not a fresh package execution or
  independently repeated package-content qualification. No author, frozen
  package, product source or old-layout file was modified. The new transport
  repair is not included in this review.

## Source findings

All source paths in this section are under
`tests/compatibility/bash-ere-runtime-integration-author-20260829/runtime-preflight-v1/v7/`.

1. `event-writer.mjs:14`: JSON serialization must return a string. Exact UTF8
   length plus newline is admitted cumulatively before `Buffer.from` and before
   the first event-file write. A refusal is sticky and does not spend additional
   admission. This is not admission before JSON serialization: the temporary
   string can already exist, so no RSS/constant-memory or arbitrary hostile
   serializer claim follows.
2. `event-writer.mjs:22`: short writes advance the offset only for safe positive
   integral counts no greater than the remaining bytes. Zero, malformed counts
   and partial throws cannot be credited as complete. Full event admission
   remains reserved after partial failure; already-written bytes are not rolled
   back, and writes are not atomic.
3. `event-writer.mjs:34`: close is attempted once. `closeAttempted` is distinct
   from successful `closed`. A close failure cannot replace the sticky earlier
   writer reason; `finalize-cell.mjs` separately records that close reason.
4. `event-writer.mjs:44` and `finalize-cell.mjs:3`: failure presence is separate
   from value. Undefined/null/false/0/empty-string reasons remain raw in memory;
   the first reason remains primary and later reasons remain ordered secondary
   entries, bounded to 16 with an omitted count. Description uses local identity
   IDs without inspecting arbitrary objects, and truncates long primitive
   strings. This is deliberately not lossless JSON error serialization.
5. `cell.mjs:20` acquires the event descriptor in its protected body.
   `cell.mjs:111` independently attempts shell disposal, array settlement,
   Worker retirement and both restorations. `finalize-cell.mjs:11` attempts the
   terminal event and then close even if the terminal write fails; a bounded
   stderr audit follows close. Audit failure produces failure exit status.
6. `dispatch.mjs:35` onward requires a single initial startup and last terminal,
   matching PID/executable identity, one final audit, safe retirement, exit/status
   agreement and exact admitted/written/event-file byte reconciliation.
   A terminal PASS before a later close failure cannot qualify as clean.
   This is source inspection only; no dispatcher or product cell was launched.

## PURE evidence and limitations

`AUTHOR-REPLAY.json`: unchanged control source SHA256
`7406169ef39fa177968889c86f1b4dbe3d57fc9c74496db6808ad0dde3116929`;
12 groups attempted, 11 PASS, C09 unqualified as described above. Only the
author control's final `fs.writeFileSync` destination was intercepted; author
files were never written. VM/module realm separation is an additional reviewer
execution-context difference and is the cause of the qualification limit.

`NOVEL-RESULT.json`: 8/8 PASS, in the main realm:

- N01: multiple short Unicode records, exact cumulative boundary, no cap-overflow write.
- N02: partial write followed by ten invalid-count variants; sticky failure and exact accounting.
- N03: partial write followed by falsy/object primary, secondary close reason and preserved identity.
- N04: nonserializable/toJSON failures occur before write and reserve no event bytes.
- N05: cap refusal precedes encoded Buffer allocation and every write.
- N06: all five cleanups, terminal, close and audit attempted; raw reasons retain order.
- N07: hostile-object identity without inspection, bounded secondary slots and string description.
- N08: missing event writer/open failure, falsy audit failure, close-once and post-close refusal.

`DIRECT-CAPTURE.log` preserves the first helper's permission-denied read of
`/private/tmp/safe-bash-core70-v4-20260829/LAYOUT-source-built.json` before any
controls. The second helper admits that explicit frozen root and completes the
DATA audit and PURE tests. The first failure is not hidden or counted as a
test pass. Helper 2 exits 0 because the review completed; its exit is not a
12/12 test-success assertion. Startup/exit capture and test result counts are
separate evidence. No product, Worker, ERE, native oracle, compiler, build,
installation or network execution occurred.

## Qualified logical bound

Authenticated manifest row sums:

| Layout | Files | Logical bytes |
| --- | ---: | ---: |
| source-built | 1390 | 8,923,286 |
| installed | 1087 | 6,261,263 |
| moved | 1087 | 6,246,595 |
| total | 3564 | 21,431,144 |

The declared calculation is internally consistent:

| Component | Bytes |
| --- | ---: |
| Retained plus fresh layout generations, including 1 MiB delta reserve | 43,910,864 |
| 210 event files at 262,144 bytes | 55,050,240 |
| 210 combined stdout/stderr captures, including final audits | 55,050,240 |
| Coordinator capture | 8,388,608 |
| Administrative/tool captures | 8,388,608 |
| Publication tails | 4,194,304 |
| Generated manifests/bindings/metadata | 16,777,216 |
| One publication copy of all unique captures | 131,072,000 |
| Existing archive | 908,381 |
| Extra metadata reserve | 8,388,608 |
| total | **332,129,069** |

Unique captures are **131,072,000 bytes (125 MiB)**, leaving 3,145,728 bytes
under the 128 MiB limit. The logical total leaves 204,741,843 bytes under
512 MiB. Final audit bytes are inside the combined pipe reservation, not a
new uncounted channel. Publication tails are counted as unique captures and
in the one-copy publication reservation.

**Conditional SOURCE acceptance only:** fresh manifests must admit actual
module/path-string deltas before copying; the equal-length-root assumption
and 1 MiB layout delta reserve must hold. Outer/admin/tail collectors must be
bounded to their declared ceilings. Only the declared roles/files and at most
one publication copy are covered. This is prospective logical regular-file
accounting, not an observed materialized-layout census, filesystem allocated
blocks, OS disk quota, RSS limit, or Git object/index/internal physical quota.
The author proposal itself leaves those future bindings unmaterialized.

## Review resources and publication

The admission window is 14:56:37Z–15:11:37Z on August 29, 2026, including
publication. Two helper invocations total: first DATA read failure, second DATA
audit plus PURE replay. No additional helper or runtime child was started.

Known executable roles through this publication command: 36 maximum, with
known peak three (the initial shell plus `git diff`/`od` pipeline). This counts
eight shell roles, the initial readers/metadata commands, three patch roles,
two Node helper roles and final explicit Git add/commit; it is an invocation-
local known-role ledger, not a universal transitive system-process census.
Git hooks, signing and automatic maintenance are disabled for this commit.

The fresh pre-receipt owned-file census is 46,812 logical bytes. A 1,048,576-byte
publication reserve covers the receipt, this report and final capture appends;
the owned logical envelope is 1,095,388 bytes, well below 192 MiB. This is not
an allocated-disk or RSS statement. Raw owned capture is bounded by the helper
at 48 MiB; tool displays are bounded source/review excerpts, not product output.

`RECEIPT.json` records exact source/evidence/seal identities, test denominators,
helper failures, the fresh file hashes/sizes, timestamp and budget qualification.
Its inventory is explicitly before receipt/report and final raw-log appends,
not an append-proof final-tree claim. The atomic explicit-path Git commit is
the final byte-binding review receipt and is returned to the requester. The
commit includes only the nine named owned files and preserves foreign staging.

## Unchanged release restrictions

ROOT's future-only resource approval is 242 known OS starts / peak four,
309 Worker starts / one live, 128 MiB capture and 512 MiB logical work. The
140-minute proposal is rejected. A later guard must enforce global 1800 seconds
including 180 seconds publication, and admit another case only when the required
case, cleanup and publication fit; the remainder is UNRUN. The current inherited
7,500,000 ms / 125-minute source guard remains unchanged and is not approved.
This review grants no actual GO and does not claim a fresh guard is qualified.

Prior private close rejection remains UNOBSERVED. H03 depth and H04 ticket
exhaustion remain SOURCE-only; H02/H04/H05/H07 remain TEST-only instrumentation.
Private T1/relevant six nonpublic obligations, fresh copied-cell/dispatcher
closure and ROOT release remain pending. No all-CORE, security, Bash/native
parity, full-package or global-HEAD acceptance is implied.
