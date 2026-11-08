# V8 — link preparation repaired; unchanged D02 byte-count contradiction

August 28, 2026. Source/preseal commit
`c4aa6e6e3e195c8b39b77db435fc8f6cc032b311`; discovery preseal SHA256
`89dda7ee6a84e37953c5736db6dedfce55df9f423db672c456743d4327c665ad`;
source seal SHA256
`da9fbf9092bf6908e65fa8c79790dad4181cf32d8e251388d20c82d13dbb6479`.
One qualification, no retry, no product execution or production edits.

## Narrow source repair

Reused Raman's proven parent-created-relative-link architecture, preserving its
4934900a and 9c4dad3091845987d538f4cbb67cd7060268444e evidence. The source audit
found BOTH symlinkSync and linkSync in the restricted child's R03 preparation.
Both now execute exclusively in the trusted outer owner, before the positive
child starts. Exact provided relative symlink/regular target and hardlink/source
are under the new owned root and source-bound in the preseal. The child validates
their identity/bytes/mode/canonical containment and applies the same refusal
assertions. No unrestricted permission or caller-selected path was added.

Five recipe inputs/modules remain byte-identical. All six control/four DATA
expectations and both planned startup-refusal controls remain unchanged. The
entire data-controls source tail from `const refusalBefore` is byte-identical.
Seven source bodies,56 historical/reference bindings and exact tools are sealed.
Two syntax checks passed before the source commit; these are not runtime passes.

## Actual qualification result

Owner PID52157 started at `2026-08-28T21:50:57.474Z`, parent79787 (pre-existing
tool infrastructure), and exited1 naturally. Persisted outcome elapsed474.596458ms;
the terminal summary, written later, reported479.84125ms.

- D00 PID52158 exited0; close observed and exact PID absence checked. Finite
  observed environment remained exactly `__CF_USER_TEXT_ENCODING=0x1F5:0x0:0x0`.
- START-POSITIVE PID52160 exited1; close observed and exact PID absence checked.
  Raw stdout emitted R01/R02/R03/B01 and D01 before D02 failed. These are partial
  emitted records, NOT accepted parent-cohort passes. The parent admits the
  positive child's records only after its required zero exit succeeds.
- Parent accepted counts: **0/6 controls,0/4 DATA**. Env-refusal, separate
  startup-open-refusal, G01/P01 and later DATA work remain UNRUN.

R03's raw record confirms execution reached the unchanged symlink/hardlink refusal
assertions after outer preparation. This does not promote historical071f8fdb
R01/R02 records, or qualify the whole v8 controller.

## Exact remaining contradiction, not a product finding

The unchanged DATA assertion at `recipe/data-controls.mjs:100` requires38 bytes.
The frozen exact diagnostic is:

```text
apply_patch: permission denied: /work/a
```

Including its one final LF, its literal UTF8 byte length is **40**, not38.
The exact hexadecimal bytes and unchanged fixture delta are in D02-FINDING.json.
Both the JSON fixture and the assertion's literal comparison use the same text;
only the numeric38 assertion/metadata contradict those exact bytes. The raw
child failure is `AssertionError [ERR_ASSERTION]: 40 !== 38`, not a permission
refusal or changed product output.

Postfailure DATA-only measurement also confirms the two frozen S74 diagnostics
remain98/92 bytes, exactly as their unchanged numeric assertions require. No
cohort was rerun, expectations changed, or candidate code imported for that check.

Minimal proposed next correction, NOT applied: separately version the erroneous
numeric38 expectation/description to40 while keeping exact diagnostic bytes,
inputs, status/effects, all negative comparisons and every other assertion intact.
Root's instruction to keep the six/four expectations unchanged prevented such a
correction in this link-only batch. Historical contradictory38 descriptions and
all original failed fixtures remain preserved, not rewritten or rescored.

## Raw evidence, bounds and cleanup

Raw pipe bytes: **1,575** (D00 stdout118/stderr0; positive stdout849/stderr608).
The owner reported32,527 persisted bytes. Positive stderr SHA256:
`ce3c55aecc36ded0ea710af863ff94e1c5cc7dc3f3374f442d22b8c2d4a10541`.
Postflight authenticated every manifest-referenced record's type/mode/hash/length,
exact output membership, and all11 source-seal file bindings unchanged.

Identity-checked scratch cleanup succeeded:586 bytes,20 entries, inventory SHA256
`85b89e95f5cbbfb4f8f2408838c913b11d973cc26f245f13f9cfb72fea1c8dda`.
No child or owner handle remains live. Raw receipts and sealed source are retained.

The actual qualification graph's total peak was2 INCLUDING the trusted capture
owner: one owner/admin/capture process plus one sequential child. No separate
capture controller, concurrent observer, delegated leaf or CLI agent existed.
This is finite known-owned-route/handle evidence, not an OS-wide census. G01 was
UNRUN, so this run does not dynamically qualify its flat Git route.

The fresh qualification/archive ledger has nine planned admissions: owner + two
children + postflight Node + two DATA-only inspection Nodes + apply_patch report
writer + Git add + Git commit. A final direct Git status adds one, for ten if all
terminal tool receipts succeed, below12; no remaining process slots authorize a
retry. Metadata/report/archive processes are sequential after owner termination.
Source preparation was separate and presealed:14 explicit process admissions
(including the pipeline shell, generator and apply_patch separately), peak3,
starting21:46:02.874Z and ending before qualification21:50:57.474Z. It is not
retroactively folded into or credited as the qualified runtime epoch. Neither
phase approaches the byte/work ceilings; no RSS/preemption claim is made.

Candidate753f33d2/tree6a59ca403c5411344dea2ee057909ba179bf7043 remains unexecuted.
The conditional product-review profile completion is still gated on qualification
PASS. This report supplies no product admission command or new grant request that
silently weakens the frozen DATA expectation. All v5/v6/v7 and071f8fdb history
remains immutable and separate.
