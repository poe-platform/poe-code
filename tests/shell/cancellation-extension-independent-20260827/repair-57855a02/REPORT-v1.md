# Independent B01 repair verdict — bounded pass

Date: 2026-08-28. Different reviewer from the author; no further workers.
The scoped helper repair passes. No new source defect or unresolved declared-API
gap was found in this bounded review. ROOT owns acceptance and any later release.

## Immutable candidate and freeze

- Author freeze/own source parent: `2d02ebe87bf7b18548190ba6a607649cef8d04e3`.
- Candidate: `57855a0293edb83bff98113123806497b4427416`; tree
  `de963dbd521d4e08efde7b13f62aeb338dbae4e0`.
- Helper blob: `a0e68c7bfb2d541964194d38ef30a4a590bec1de`; source SHA-256
  `2685ad5723036ef217881e3c3b5f62882a2647e287f518d3cfd4f8416fc330a2`.
- Author evidence read first: `b620f32b08fa473105ff095471f6be57e91d2abc`.
- Independent semantic/executable freeze:
  `589f90eae8dfa493558b5c62221590c86805f05a`.
- Evidence manifest SHA-256:
  `a8174968fa258aaca79927924ef213bf8c8108a0be8f529b22a0617bc83ce10f`.
- Raw object/path proof SHA-256:
  `c7fe5c87e487e3523f7e4773e24232571541e623caf6ad141d36e7901904217e`.

Evidence and audit commit identities are appended in HANDOFF-v1.md after the
evidence commit exists, without inventing a self-referential commit hash.

## Separate results

| Cohort | Isolated committed-source build | Moved internal ESM/declarations |
| --- | --- | --- |
| Exact unchanged extension | 12/12 | 12/12 |
| Exact unchanged original Stage1 | 12/12 | 12/12 |
| Exact unchanged nearby repair | 4/4 | 4/4 |
| Two frozen repair-specific groups | 2/2 | 2/2 |
| Original positive types | pass | pass |
| Original six malformed rows | six targeted diagnostics | same six diagnostics |
| Extension positive types | pass | pass |
| Extension eight malformed rows | eight targeted diagnostics | same eight diagnostics |

These are separate cohorts, not a combined superiority or full-gate score. There
are no cancelled, skipped or TODO rows. Moved results repeat the same fixtures;
they are not extra unique controls. Source type checks consume the archived TS;
runtime's first mode uses its isolated emitted ESM. Moved checks consume the actual
copied declarations after source/build removal, with --listFiles path/hash evidence.

The single targeted counterfactual is an EXACT revert to the author freeze's helper
(SHA-256 `f628801379acd1c86c247a778e973f4cb89f8bbe2c3089f8192c31f3c5b273a5`).
It compiles, loads through the same guard, and fails unchanged E07 with ERR_ASSERTION.
Candidate E07 passes first. Result: **one behavioral kill**, not a compiler/loader
failure or an additional product pass. No old mutants or all-author suites rerun.

## What the repair establishes

The raw tree reconstruction proves the candidate changes only cancellation.ts
versus its OWN parent, which is the author freeze. The exact two-line replacement
at helper lines 784-785 preserves a captured throw unless its authenticated origin
is invoke-option, retaining the authenticated control report when present. Root
caller selection still happens first. Authentication precedes ranking; unproven
equal/falsy/NaN reasons do not gain a report or invoke-cancellation classification.

Unchanged E07 now passes. New N1 covers two contrasting schedules: budget control
first and pipeline control after an invoke abort. The latter obtains the authentic
origin from its original control frame's declared subscription, not a guessed
child delivery origin. Both observed-origin and report routes preserve control
reason/signal/frame/role; root override and separate return ranking remain intact.
New N2 checks false/NaN control reports, unrelated errors, missing provenance and
sibling lineage/target isolation. These cover gaps, not a broad role/order matrix.

The accepted Stage1 selector and all helper code preceding the runtime selector
are byte-identical to the author-freeze source. Emitted declarations are also
byte-identical to the rejected extension's previously captured declarations:
SHA-256 `7edba703edd9d09da8fc6b1b754722695d9af2fba9fac0669408bbe1e79eb79d`.
New emitted ESM SHA-256:
`4b8bfbd52a001ab307bae25230d63275ba2073e7d4e62893c66f075a45e67561`.

## Independence, preservation and limits

This freeze is POST repair candidate commit, PRE repaired implementation inspection
and execution. The old implementation and rejection were already known. Exact
author repair docs and prior independent controls were read first; exposure hashes
and the old-layer snapshot are in FREEZE-v1.json. No author executable was inspected
or replayed. Author 4/8 -> 8/8, 22+22+5 and type/build claims remain author history.
Its pre-freeze fixture correction is disclosed; its v0 raw TAP was transcript-only,
not fabricated as an archived repository capture.

All 218 old extension-layer files remain byte-bound to their original Git tree.
The ONLY excluded subtree is this explicitly authorized repair-57855a02 append;
new files are sealed separately. Complete old Stage1 and author histories remain
unchanged including additions checks. Original 11/12 on 373437 and original 10/12
red evidence are not rescored. Both unchanged historical verifiers still pass.

The proof verifies 90 raw Git objects, candidate-only helper delta, the three-file
independent freeze delta, exact fixture paths, and unchanged reserved runtime,
contracts, shell, exports and package paths at the proper candidate baseline.
Scoped live snapshots are separate; no ignored 21 GiB source scratch traversal or
live overlay. Other-owner HEAD movement is allowed: each full foreign index matches
its contemporaneous HEAD, while staged foreign entries remain unchanged. Reserved
live paths stayed unchanged during the run. No product or private checkout write.

Regular-copied installed Node v22.22.2 and TypeScript 5.9.3 are inventoried before
and after; no installation/network. Nine runtime loads authenticate exact helper
and fixture bytes. All 23 direct launches and nine instrumented test children exit
naturally, with bounded watchdogs unused. Source, tools, fixtures and artifact
membership checks include additions. Enumerated owned scratch is removed only
after durable captures. No unexpected runtime, fixture or infrastructure failure
occurred in this repair run; the deliberate revert's red result is retained.

The inherited registrar is TEST-LOCAL. Origins are supplied under the declared
trusted-host assertion, not proof of an actual runtime Promise race. R08's status 1,
diagnostic/report discard, real outer/root cancellation, and InvocationCancellationOwner
remain DESIGN ONLY. No Runtime/Shell/public integration, native suite, global gate
or Stage2 release is authorized by this pass.

## Reproduction

Read-only durable verification, no helper execution:

```
node tests/shell/cancellation-extension-independent-20260827/repair-57855a02/audit-v1.mjs verify
node tests/shell/cancellation-extension-independent-20260827/repair-57855a02/audit-v1.mjs verify-commit
```

Optional bounded replay requires a NEW owned output name and installed tools:

```
node tests/shell/cancellation-extension-independent-20260827/repair-57855a02/run-v1.mjs prepare replay-new
node tests/shell/cancellation-extension-independent-20260827/repair-57855a02/run-v1.mjs baseline replay-new
node tests/shell/cancellation-extension-independent-20260827/repair-57855a02/run-v1.mjs finish replay-new
```

Never overwrite evidence-v1 or change old controls. Stop after this helper review;
ROOT decides whether the repair is accepted and whether Stage2 work is released.
