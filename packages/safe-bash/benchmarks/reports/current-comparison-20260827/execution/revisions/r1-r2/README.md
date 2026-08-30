# R1/R2 only — awaiting independent recheck

Only existing `execution/expanded.mjs` changes. `snapshot-complete` now follows
the awaited shared snapshot for both engines; final `raw` encodes the already
converted, unprojected channel buffers. Baseline stderr remains qualified as
UTF-8 of public text. The scored four-field comparator and helpers are unchanged.

`expanded-regression.mjs` invokes the actual adapter for both engines/profiles,
holds a real synthetic VFS read pending, and checks phase order, binary channels,
origin projection and the unchanged scored predicate. All four cases fail before
and pass after. The unchanged reviewer adapter controls report no issues; the
existing28 synthetic child sentinels also pass. These are not product observations.

Run the targeted regression from the repository root:
`node --test benchmarks/reports/current-comparison-20260827/execution/revisions/r1-r2/expanded-regression.mjs`

`REVISION.json` is an additive source override/evidence record, not approval.
The original280-file manifest, REUSE, author receipts and failures stay unchanged;
its original adapter bytes resolve through `expanded.before.mjs.data`. Original
current-source claims are historical, not certification of this repair. New raw
sentinel attempts remain at the pinned isolated temporary paths in the record.
No product/MEASURE/native/performance/du work, other-owner edits or commit.
ROOT candidate SHA/pack remain absent. Stop for the different reviewer's recheck.
