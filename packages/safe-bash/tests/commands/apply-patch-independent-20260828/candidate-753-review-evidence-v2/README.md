# Actual independent apply_patch753 review — completed, not all-green acceptance

The conditional ROOT-authorized **fresh full54 run actually completed 54/54
jobs**. This is not a proposal, nor does process completion imply every case
passed. There were no safety/capture/integrity/unknown-retirement stops and no
retries. No candidate product source or expectations were edited during the run.

## Exact source and package binding

- Harness repairs/control preseal: `a90fa437047c1edacabcc3384b622179c84bf14d`.
- Full54 actual preseal/source commit: `e0c80061c212929159ee3e727018d116f1534e8b`.
- Actual preseal SHA256:
  `d75db6e78b9a891705c8d8ffd753ef54624df4bb64b1670a523ecb365290e364`.
- Built runtime artifact commit: `9790b146fda6e78083e4016754fd38916a53402c`.
- Candidate: `753f33d2fa1a2ccd86089c563d4ad66b9a1ae26d`.
- Derived tree: `6a59ca403c5411344dea2ee057909ba179bf7043`.
- Fresh strict-built full882 package matches SHA256
  `f04afbf9230fd9e3275f83c7dab26837aeb618bd6178f4ac0b794b93302d6d95`.

The DATA/SYNTHETIC prerequisite is a distinct **31/31** versioned cohort, with
D02-v2 exact30 overlay IDs and both admission fixes. Original `569a4b89` 22/23
and its wrong10 assertion remain untouched. The fresh review redoes setup/build;
no old 3/54 setup result or product pass was inherited.

## Actual verdicts

| Cohort | Actual result | Qualification |
| --- | --- | --- |
| Setup | 3/3 completed | Exact source, binding negatives, strict build |
| Types | 15/15 expected outcomes | Positive, invalid option, repairs and root-negative across source/installed/moved |
| Unchanged author cases | 189/189 | 63 per layout, independently replayed author expectations |
| Frozen legacy records | 346 PASS / 11 FAIL among 357 classified records | Plus21 other records not counted as passes; see below |
| Versioned fixture tail | 12/12 | S62/S64/S71/S74 v2 choices, four per layout |
| Unmodified S54 U01–U12 | 33/36 | U12 fails in all three layouts |
| Instrumented S54 | 44 PASS +4 expected mutation failures | All12 before/mutant/restored graph groups accepted;4 targeted mutations killed |
| Limit endpoints | 16/18 | L07/minus and L07/at fail; L07/over passes |
| Owned Real adapter | 4/4 | Scoped local filesystem, not every host/provider configuration |
| Mock S3 adapter | 4/4 | Mock protocol/profile, not deployed S3; no WebDAV run claimed |
| Original loaded mutants | 6/6 killed;12/12 before/restored positives | All18 triplet phases accepted with observed markers |

All36 runtime worker groups report completion and zero unhandled rejections.
Per-module loaded URLs, byte counts, hashes and modes are retained in the raw
final records. The full882 package inventory is not misrepresented as882
evaluated modules.

### Preserved legacy cohort, not current fixture failures

Each legacy worker reports126 records and119 invocations. The source layout has
115 PASS/4 FAIL, installed116 PASS/3 FAIL, moved115 PASS/4 FAIL. The11 failures
are exactly S62/S64/S71 in every layout, plus S74 in source and moved. Those old
expectations were already adjudicated by ROOT; their separate versioned tail is
12/12, not a rewrite/rescore of the legacy records. Seven additional records per
layout are outside the postprocessor's PASS/FAIL/HARNESS_ERROR classifier;
their full records remain in REPORT.json and raw evidence, with **no pass credit**.
Do not collapse this into a fabricated original32+80 all-pass denominator.

### Findings to route before product acceptance

1. **U12, three layouts:** the frozen unmodified test fails with
   `false !== true`. It exercises `Shell.exec('run_patch')`, nested
   `context.invoke('apply_patch', [update])`, a throwing stdout sink, optional
   caller abort, and registered asynchronous cleanup. Its assertions require
   rejection/reason identity, cleanup completion and retained published bytes.
   Exact test body: executor `s54.mjs` lines174–185; full stacks are under
   `s54-unmodified-*` in REPORT.json and the corresponding raw final records.
   Route to Poincare/root, with Sagan if the Shell error layer is involved.
   **Contract/fixture versus source defect is not adjudicated here.** No claim
   that a sink error necessarily has a different existing public error contract.
2. **L07/minus and L07/at:** the positive path endpoints fail their frozen
   expected effects; the over-limit endpoint passes. The exact generator is
   executor `legacy.mjs` lines340–345: an absolute filename formed from
   `16383 + delta` repeated characters and an Add header. Full status,
   diagnostic and namespace differences are retained in the case assertions.
   Check interactions with the other fixed parser/VFS limits before assigning a
   product bug or altering the boundary fixture. No cap was lowered or raised.

The four instrumented mutation failures and six original-mutant failures are
intentional kills, **not ten product defects**. No unchanged baseline/restored
instrumented failure is reported. U12 and the two positive L07 rows remain
unresolved; therefore this report does **not** grant all-green product acceptance
or root/default integration.

## Capture, cleanup and budget proof

The actual committed runtime batch is **1,071,999 bytes including Git framing**,
below the unchanged16MiB cap. Both BUILD-RECEIPT and normalized RUNTIME-SEAL
were jointly admitted before publication, with the65,536-byte commit reservation
and later exact-size check. Publication measurements are preserved in
REPORT.json/capture/publication and OWNER-EVENTS.jsonl.

- Controller:62 owned processes,61 child receipts, peak2, approximately263.5s.
- Every child: close observed, exact PID absence checked at retirement, no
  signal or capture failure. Owner tool returned exit0. No active child remains.
- All **11,666,114 observed child stdout/stderr bytes retained; zero lost**.
- Controller capture artifacts plus external records/index: **74,164,910 bytes**,
  below128MiB. All190 declared regular members and exact append-aware run
  membership passed independent hash/mode checks.
- Archive:47,298,696 bytes, SHA256
  `5db05ef22fe66ce548316ca72a74937abc0c435690c4434df168582f37d5027f`.
  Independent bounded decompression/CRC verifies209,745,917 decoded bytes.
  No independent per-file reconstruction is claimed. The controller records
  29,495 files/154,905,565 logical bytes and checks its work tree before removal.
- Actual work directory is absent. Postguards authenticate all20 sealed source
  files and80 named external bindings; no foreign source changes were repaired.

ACCOUNTING.json lists all roles:62 controller-owned +1 grant materializer +7
bounded postflight/editor/Git calls =70 conservatively. The earlier REPORT.json
budgetAccounting prose mentioned a planned final status query; the actual last
seven calls instead include a bounded selected-row inspection and no separate
status query. No extra process was launched to exceed the quota. All created
owned evidence paths are included in the final explicit-path commit; the
append-aware capture/source postguards already passed. Developer inspection
output is not relabeled as raw worker capture; REPORT.json retains the complete
case data even where the tool display abbreviated a large assertion diff.

## Preserved history and remaining limits

Original `685cdd0d` HOLD3/54/51 unrun and131,072 irrecoverable unretained bytes,
`5f336d1a` binary-output HOLD/380,995,389 reported omitted bytes/raw exact unknown,
all earlier HOLDs and the original22330550→1013387 DATA roundtrip remain intact.
Nothing is reconstructed as missing raw output or promoted into a new pass.

This is the pinned fixed-limit Codex-format subset, not full native CLI parity,
a hostile-host-JavaScript sandbox, atomic namespace publication, rollback of
accepted effects, a hard RSS guarantee or universal preemption. No native oracle,
external network, private repository, production edit, public root export or
default registration was used or changed.
