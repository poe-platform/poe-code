# Independent helper extension verdict — reject B01

Review sealed 2026-08-28 UTC (2026-08-27 America/Chicago). This is a bounded
different-reviewer helper review, not Stage2 authorization or whole-product proof.

## Exact identities

- Author contract freeze: `88d91975e4a718fb3c1b55322e44492cf4059391`.
- Candidate: `373437cf84424939e1792470805cdd9e60bd3898`; tree
  `8e9037f29aa030406cffb7595371041c91c08ae7`; its own parent is that author freeze.
- Helper blob: `3b7b55abc14718c0e23aa0c352af392b967a4905`; SHA-256
  `f628801379acd1c86c247a778e973f4cb89f8bbe2c3089f8192c31f3c5b273a5`.
- Author evidence read, not adopted as independent results:
  `efa819f79516b27690e7b2a362cea1231c6b7fef`.
- Independent semantic/executable freeze:
  `cbed682564e1e3b1c2ac8062157ece7b8b997f30`.
- Evidence membership manifest SHA-256:
  `02b99df59034dfb65ae53a2c47895dabc9b70b30e05bac01dc78baec1917acd5`.
  The final evidence commit and its raw path proof are recorded separately after
  committing this report; a commit cannot include its own final hash.

## Results, kept separate

| Cohort | Isolated committed-source build | Moved internal artifact |
| --- | --- | --- |
| New frozen extension | **11/12**, E07 fails | **11/12**, same E07 failure |
| Unchanged original independent Stage1 | **12/12** | **12/12** |
| Unchanged nearby repair controls | **4/4** | **4/4** |
| Original positive types | pass | pass |
| Original six malformed type rows | six exact targeted diagnostics | same six diagnostics |
| Extension positive types | pass | pass |
| Extension eight malformed type rows | eight exact targeted diagnostics | same eight diagnostics |

No runtime row was cancelled, skipped, or TODO. Source type checks use the archived
TS helper; runtime's first mode uses its isolated emitted ESM. The second runtime
and type mode uses regular-copied INTERNAL ESM/declarations after source and original
build removal. Moved repetitions are not additional unique passes. This is not a
barrel/package export or direct Runtime/Shell test.

Four additional `--listFiles` compilation replays bind the actual moved declaration
bytes consumed by the compiler and every library/fixture path; those are provenance
supplements, not four new type controls. Node v22.22.2 and TypeScript 5.9.3 are regular
copies of installed tools, byte-bound before and after; no install or network.

Counterfactuals: **4/4 targeted behavioral kills** after successful compilation and
authenticated module loading. Each uses a candidate-passing witness: E01 premature
acquisition; E04 missing activation recheck; E08 reason-equality classification;
E11 omitted rollback. None uses failing candidate E07 as a kill witness. The
counterfactual rollback test deliberately exposes leaked listeners in its isolated
child and terminates naturally; no product source is mutated.

## B01: source correctness defect

`selectRuntimeCancellationOutcome` at candidate `src/shell/cancellation.ts:784`
only preserves an unclassified throw. Its line 797 consequently substitutes the
outer invoke for an authenticated budget/pipeline-control failure. Inherited
README lines 55-61 require exact control failures to remain unrelated execution
failures for invoke replacement; stricter authentication does not change that rank.

Frozen E07 first proves original nested lineage, B-before-A delivery, no artificial
invoke rank, and ancestor-before-getter admission. It then expects the authenticated
B rejection to remain B despite an outer invoke abort; that assertion fails in both
modes. The post-freeze diagnostic B01 confirms for BOTH control roles and BOTH
observed-origin/descendant-report routes: actual `outer-cancel`, expected
`control-failure`, with the report incorrectly changed to `invoke-option`.
Unproven throws, the unchanged Stage1 selector, and actual root priority retain the
expected behavior. Diagnostic contrasts are not new independent family counts.

See `BUGS-v1.md`, `evidence-v2/extension-isolated.stdout`,
`evidence-v2/extension-moved.stdout`, and `evidence-v2/bug-E07-isolated.stdout`.
ROOT was notified after the first frozen failure and after exact diagnostic capture.
No implementation patch or abstract design approval is supplied.

## Trust and scope limits

The freeze is POST candidate commit but PRE candidate implementation inspection and
execution. Earlier DESIGN/linked HANDOFF exposure, current author contract/handoff,
accepted Stage1 declaration/private-state type excerpt, and old independent fixture
envelopes are disclosed in FREEZE-v1.md/JSON and supplemental raw-object bindings.
No author extension executable bodies or all-author 22+22+5 suites were copied/run.
Their baseline missing-API failure, typing failure and activation-replay supplement
remain author history, not independent results.

E03's registrar is TEST-LOCAL. Observed origins come from subscribeCancellation;
supplying one is the trusted host's assertion, not a helper-proven Promise race.
No private-symbol forgery defense or arbitrary async provenance is claimed. R08's
status 1 plus diagnostic/report discard, R09/R10 real ancestor abort, and
InvocationCancellationOwner remain DESIGN invariants requiring real runtime seams.
Stage2 remains HELD even if a future helper revision passes.

Original independent 10/12 red reports, twelve original controls, nearby four,
repair passes and all author frozen fixtures remain byte-for-byte intact. Complete
historical subtree memberships are reconstructed from archived raw Git trees;
before/after live memberships also check additions, not only original file paths.

## Evidence and retained infrastructure failures

The proof reconstructs 107 authenticated raw Git objects without loose-object
assumptions or a new branch. Candidate-versus-parent full tree reconstruction changes
only the helper. Independent freeze-versus-own-parent changes only six owned files.
Reserved contracts/runtime/shell/barrels/package trees are unchanged at the candidate
baseline; live reserved files are separately unchanged during capture.

Eleven runtime module loads bind exact fixture and helper artifact bytes. All 26
primary child launches and four declaration-binding replays terminate naturally;
each launch has a bounded watchdog. Source/tool/fixture/artifact inventories include
membership additions. Both enumerated scratch trees are removed after durable
captures. No private checkout, native oracle, full cohort, guest or runtime edit.

Retained non-semantic attempts: pre-freeze Git-output buffer overflow; evidence-v1
overbroad live inventory encountering unrelated ignored 2 GiB archives; evidence-v2
full-index equality vetoing another owner's legitimate commit; reconciliation parser
not initially handling newline-containing foreign paths. Exact execution errors and
driver versions are preserved; PREPARATION-ATTEMPTS-v1.md and ATTEMPTS-v1/v2.md explain
the corrections. No frozen assertion was changed or failing helper row rescored.

Foreign STAGED edits stayed empty. Full raw index changed as another owner committed
twelve `which` paths; each index is reconstructed against its contemporaneous HEAD.
The report deliberately does not call those full indexes identical. No foreign path
is staged or committed by this reviewer.

## Reproduction

Read-only durable proof and membership verification (does not execute the helper):

```
node tests/shell/cancellation-extension-independent-20260827/audit-v1.mjs verify
node tests/shell/cancellation-extension-independent-20260827/commit-audit-v1.mjs verify
```

Optional bounded replay into a NEW owned output name, using the exact pinned source
and frozen fixtures (never overwrite evidence-v1/v2):

```
node tests/shell/cancellation-extension-independent-20260827/run-v1.mjs prepare replay-b01-new
node tests/shell/cancellation-extension-independent-20260827/run-v1.mjs baseline replay-b01-new
node tests/shell/cancellation-extension-independent-20260827/run-v1.mjs probe replay-b01-new
node tests/shell/cancellation-extension-independent-20260827/run-v1.mjs finish replay-b01-new
```

The expected candidate verdict remains **REJECT B01**, not an all-green replay.
Raw outputs and immutable memberships, not this summary alone, are the evidence.
