# Independent getopts Stage2 review — August 27, 2026

## Recommendation

**Recommend scoped acceptance of candidate618d8967 under the approved root
profile. No source bug is confirmed by this review.** Root retains the runtime
release decision. This is not full Bash parity, a global product gate, default
plugin growth, just-bash superiority or a72-hour completion claim.

Candidate: `618d8967009117547ab476256bc6eb0a9463309a`.
Author evidence: `cb94b17d0eefc62e2a51f5a6f7cf46ebbcad2faf`.
Accepted owned-output baseline: `eba049535d154f4e028f57ffd8efd7622b2239ca`.
Independent correction freeze: `e974d60a1c7153aa0491799e4784249311d62099`.
Session: `01a0450f-ec52-77a1-9444-d9e2be8237fc`.

## Actual independent results — do not sum overlapping cohorts

| Named cohort | Passed / denominator | Failed / blocked / untested within cohort |
| --- | --- | --- |
| Initial installed independent public controls | 25/26 | 1 reviewer D03 expectation error;0 confirmed source defects |
| Frozen N01-N16 product-policy scripts, subset of preceding26 | 16/16 | 0; not native parity or retrospective native rescoring |
| Separate D03 correction v3 | 1/1 test, three bounded observations | 0; original25/26 remains intact |
| Remaining cadence/pre-abort/late-reject/concurrent-invoke controls | 3/3 | 0 |
| Existing getopts runtime author suite, independently rerun | 83/83 | 0 skip/todo/cancelled |
| Existing legacy core, after isolated build | 505/505 | 0 skip/todo/cancelled |
| Existing legacy state | 203/203 | 0 skip/todo/cancelled |
| Existing owned-output author operation/shell/network | 42/42 | 0 skip/todo/cancelled |
| Existing independent owned-output holdouts, unchanged fixtures | 36/36 separate children | 0 |
| Existing moved public owned-output fixture | 9/9 profiles in1 passing Node test | 0 |
| Strict source/runtime/owned-output types | 3/3 compiler runs | 0 |
| Actual installed declaration positives | 2/2 compiler runs | 0 |
| Malformed installed option/sink/invoke fixtures | 3/3 rejected for targeted TS2322 | Four diagnostic messages; not load/compiler infrastructure errors |
| Installed load identity | 1 positive;2 required rejections | 0 unexpected outcomes |
| Semantic mutants | 2 meaningful kills | 1 earlier checkpoint-loader attempt blocked; not a kill |
| Current actual SafeJS profiles | 8+11+6 =25/25 qualified profiles | 0 blocked/nonpass; qualification is not25 guest-capability successes |

No requested named candidate cohort remains blocked or unexecuted. The historical
blocked mutant attempt and reviewer failures remain recorded. Unmeasured/out-of-
scope categories are explicit in COVERAGE.md, including no new native runs and
no separate getopts-specific SafeJS guest. There is no invented unique total.

## Package and implementation identity

All product execution uses an isolated committed archive, never live source.
The complete src/build closure plus selected unchanged suites comprises988 files
and1107 file/directory entries. Exact blob IDs/modes/hashes authenticate archive
extraction. Non-generated source membership matches before/after, including new
entries; generated dist and copied public development tools are separately bound.

The full package is built, packed with local offline npm, installed from the real
tarball with scripts/network installation disabled, then **physically moved** to
a different regular consumer directory. The original consumer path is absent.
Installed dist matches all828 emitted files; the package has830 files, including
the unchanged package manifest and README. This is neither a moved dist-only
module nor a copied facade. Root public Shell execution, strict declarations and
load auditing target the actual moved installation. Wrong package binding and
unexported internal subpath controls reject for their intended reasons.

Actual npm tarball SHA256:
`08667ba7a67c5e9342c062007265279965138afe99c700f756df3e8ec97533f3`.
The tarball and emitted declarations are preserved in evidence-v1/public-package.tgz.
Source, raw commit/root tree and selected blob inventory are retained separately.
Candidate is reachable from main, not a synthetic/dangling identity.

Candidate's own production delta is ONLY runtime.ts/shell.ts. Both baseline path
hashes match eba; all243 protected candidate entries match baseline metadata;
all26 accepted owned-output added lines remain. The full eba-to-candidate tree
also contains earlier expr/html-to-markdown changes. Those are accurately retained
as package context, not misreported as this author's scope violation or removed
by transplanting a different source tree. Runtime/shell/helper final hashes and
complete preservation dimensions are in evidence-v1/PRESERVATION.json.

## Policy and source review

Approved `f9d8737b6e391b20062f6f2a12d8fbec94e80ae8` D02/D03 mappings and root D01
govern, not native failure quirks. Candidate runtime.ts:1607-1673 performs bounded
admission and private scan, publishes hidden state, awaits diagnostics/checks
signal, then checked OPTIND/OPTARG/late name writes. First failure stops later
publication. Runtime.ts:355/375 retains checked readonly behavior; :316/320 and
:1644 preserve saturating private caps; :515/516 retains normal command admission
and128-command yield; getopts.ts:119/184 retains checkpoint/final flush.

Dynamic function snapshots and cloned child metadata are exercised, not inferred
from a mock invoke. Runtime.ts:1570 compares final child binding after exported
removal/env installation; :925-935/:990-994 retains the direct middleware's
existing conditional restoration. Source references are to candidate618d8967.
COVERAGE.md maps all12 frozen invariant groups to actual evidence and limits.

N05's corrected repeated local produces a; Bash5.3 caller resumes b, historical
3.2 resumes a. N13 native retains old on the no-argument step, deletes at EOF and
emits two readonly diagnostics (5.3 lines3/4;3.2 lines2/3). Product D01 never
permits that deletion and stops after checked failure; N04 exact visible/hidden
prefix restoration deliberately differs even on success. Native projections,
product projections and stderr-byte equality are separate in the evidence.

## Retained reviewer errors and corrections

1. Preparation1 selected nonexistent LICENSE and failed Git archive before
   candidate extraction/execution. Original driver fc727249 and stderr/status
   record remain; a4709b75 removes that path only. No license/product file added.
2. Before public execution, the reviewer used nonexistent registry names().
   3aa27746 corrects it to inspected list().map; initial16e6b988 remains in Git.
3. Initial public D03 expected b:2 after same-value promotion, but correctly got
   EOF ?:2: promotion does not reset, second scan publishes2 and skips restoration
   against overlay1. Original25/26 and exact raw output remain; separate v3
   checks the approved same-value rule and both restoration branches.
4. Initial task-checkpoint mutant anchor matched two emitted locations and was
   refused by its loader. Collection1 rejected the missing binding rather than
   accepting that process failure as a kill. Original loader/logs and collection
   failure remain. The separate v2 anchor binds getopts-local checkpoint only;
   the unchanged positive final-flush test then fails with Missing expected
   rejection. Cursor-publication mutant independently fails the intended N05
   continuation assertion. Product files remain unchanged throughout.

See PREPARATION-01.json, COLLECTION-ATTEMPT-01.json and DRIVER-CORRECTIONS-v2/v3/v4.
Preparation/collection outer Node stack traces remain in this session's terminal
record; artifact records retain their exact root cause/status and original drivers.
No failure is silently relabeled, deleted or converted into a source finding.

## Actual SafeJS qualification and preservation

All25 existing profiles actually execute the current legitimate engine once each,
on regular copies. Each child authenticates63 engine source files and185 product
modules. Each cohort checks fresh private HEAD/tree/index/status, six metadata
inputs and264 eligible engine records before/after; all match exactly. Unknown
imports, prerequisite dependence, output/heap/watchdog bounds and stop-on-nonpass
rules remain. Original loader/private guard/guest/case/assessor bytes are unchanged.

The explicit relocation replaces the original broad /private/tmp prefix with
this exact owned regular work prefix; it is documented before execution in
SAFEJS-RELOCATION.md, with original/adapted hashes. Current source/package/compiler
and adapted harness membership are checked before/after, including additions.
No private repository/module-tree write, engine installation or vendoring occurs.

Successful guest evidence includes actual stdio/VFS/args/cwd/env, supported
namespace operations, shell.exec returning shell-positive, aliases/bytes, live
callbacks, explicit children and curl with an explicit injected mock transport.
Missing registerCleanup/acquire, forbidden function spread, exhausted budgets,
error precedence and closed/error transport profiles are qualified controls,
not successful authority acquisition or deployed network acceptance.

## Seals, chronology and scope

Original51f14914 controls and bf3bfd63 policy predate the candidate. Correction
freeze e974d60a postdates candidate but precedes this leaf's implementation
inspection/execution. Initial documentary/archived-script exposure is disclosed
in FREEZE.md. Supplemental executable controls are honestly post-inspection and
committed before their execution where practical; their commit sequence remains.

Original Phase1 179 files/182 entries, Stage2 23 files/25 entries, three policy
files and all seven correction-freeze files remain unchanged. Layered integrity
authenticates those original boundaries, explicit appends, exact review artifact
membership and separately classified task scratch. Old exact-tree verifiers are
neither patched nor claimed passing with appended membership. All bounded parent
processes and25 SafeJS children close; no known owned children remain.

The evidence retains470 raw capture files, the original committed source archive
and actual npm tarball. After artifact verification, cleanup removes8664
hash-authenticated task files and694 enumerated directories using file-specific
unlink and nonrecursive rmdir. Exact scratch membership remains in SCRATCH.json;
CLEANUP.json records completion. No private engine bytes are committed, and the
original private source/module trees are never cleanup targets.

Preserve original Phase1 237/238 runtime and27/28 type history; R01-R03 remain
separate3/3 per mode, corrected T20 28/28 remains separate. Original Stage2
Darwin Bash5.3 14/16 and Bash3.2 9/16 are untouched. No final report rescoring.
Only new review-subtree files are committed with explicit paths and --only;
foreign staging, original captures, product/AGENTS/package/exports and user
branches are untouched. REPRODUCE.md describes artifact verification and replay.
