# Stored module-source compilation budgets

## Main integration

After the independent await/restore commit 2b376fd7a, main reproduces seven
budget failures and one existing snapshot-length rejection control (57d157).
Valid and oversized restore controls use independent budgets to avoid an
unrelated duplicate-intrinsic error when reusing a restored realm's budget.
The source-length and per-UTF-16 work checks are now applied on main, with
README updated. Main focused checks passed all 60 tests across four files
(4afdd8). Lint/TypeScript passed (924de7, session 35980 terminal). The maintained
workspace build passed all 23 build tasks and five fresh-process import checks
(b78b5c, session 19147 terminal).
No push or release occurred.

## Validated gap

With maxSteps=1,000, stored module compilation accepts both a 2,000-character
comment and 2,000 empty statements while recording zero steps. Dynamic
function compilation of the same bodies fails at step 1,001 (e2971b).
Direct regressions also show that configured stringLength is not checked.
All four initial regressions fail (ed404e).

This concerns source records restored from snapshots, not a claim that every
root-source parser operation currently has per-character accounting.

## Independent candidate

`/tmp/safejs-module-budget.n3VXMj` is copied from main runtime a5919f095 and does
not include the ordinary-await execution/restore candidate. Keep the budget
improvement separate at integration.

Before createModuleSource parses or registers its source, enforce the owner's
stringLength limit and charge one step per UTF-16 source unit. This follows
the existing dynamic-function and eval compilation accounting pattern.
Owner-free compilation remains available. No source wrappers are synthesized
for module bodies; regex compilation retains its additional work accounting.

Focused budget/source/restore tests passed all 36 cases across three files
(60bcae, session 68514 terminal). Targeted lint and TypeScript remain running
in session 37729; broader restoration qualification remains pending.
Session 37729 subsequently completed successfully (94341c), before adding the
restored-record tests. Those tests cover public and low-level restore with
valid-size controls followed by oversized source. Low-level restore already
rejects excessive string length during snapshot validation (430132), before
compilation; retain that SnapshotValidationError instead of relabeling it a
fatal compiler error. Step exhaustion must still propagate as SandboxError.
Fresh focused checks passed all 40 tests across three files (1ec363, session
52407 terminal). Static checks for the expanded file remain running in session
9062. This candidate remains independent of the await/restore candidate.
Session 9062 completed successfully (e36b6b): targeted lint and package
TypeScript checks pass for the expanded eight-test budget file.

Interaction testing with the ordinary-await repair uses the separate combined
copy `/tmp/safejs-await-module-combined.fQq7Bt`, session 96601. The budget-only
candidate remains unchanged. Preserve separate commits at integration.
Combined qualification passed 4,560 tests with one opt-in skip across 284 files
(584485), with targeted lint and TypeScript passing (b678e1).
The test data is in memory and does not create files.

## Delivery

Main integration began after full session 63590 became terminal. Red/green
checks and README are recorded above; the separate local commit awaits static
and build checks. No visual CLI change requires screenshots. No push or release
during the hold.
