# Final frozen tree replay — awaiting root seal

Candidate `436bda3e21b2b6041409fac7408cf072b5d3fe5e`; original 38 selections
executed exactly once on August 27, 2026. Completed independent peer report
explicitly approved the exact N18 v2 helper before product execution.

- Fresh cohort: **31 raw passes, 1 accepted-profile raw failure (N16),
  3 unsupported/not run, 3 characterizations/not passes**; 35 tree invocations.
- Native 20: **12 exact matches, 5 differences, 3 unsupported**; all original
  captured bytes/statuses reused unchanged, zero new native executions.
- Separate typed built standalone plugin smoke: one additional tree invocation,
  pass. Total fresh tree calls here: 36; no retries, no reused product results.
- Scoped compiler/build pass; all 15 canonical owned tree TS files appeared in
  successful compiler input lists. No root/default integration or full gate.
- Final source cohort includes committed Shell plugin-lifecycle changes as well
  as four changed tree modules. `analysis.json` identifies every loaded hash.

`initial-results.json` is the **fresh final** result: its filename is retained
from the byte-identical historical driver, not evidence reused from initial38.
Original initial38, preseal, native20, v1/HOLD and v2 history remain elsewhere,
unchanged. N18 v2 is the only predicate correction. N16 remains not parity.

Run offline checks, with Node builtins only and no product/native execution:

```sh
node --test tests/commands/filesystem-inspection-stress/tree/evidence/final-436bda3/verify-final.test.mjs
```

These checks validate captured evidence; they do not rerun the source cohort.
No additional product execution is authorized. The copied driver can support a
future explicitly authorized fresh freeze; its original `raw` directory guard
prevents silently rerunning into this result directory. Do not use the historical
root `run-frozen.mjs` to represent this final/v2 cohort.

## Data classification and retention

`harness/` contains the unchanged original fixtures/corpus and final v2 runner.
Its `native-fixtures/` contents, including path/control/symlink fixtures, are
oracle input data, not canonical TypeScript. Raw `.bin`, JSON, TAP, logs, diffs,
and manifests are capture/evidence data. `consumer.mts.txt` is the exact captured
standalone off-repository consumer source, actually compiled and executed before
publication; it is not a newly added repo source requiring missing build imports.
`loaded-source-data/*.ts.txt` preserves exact loaded candidate source as data;
canonical source stays at the committed candidate and is compiler/hash checked.

Full immutable candidate, copied development dependencies, 125 build artifacts,
raw V8 coverage and process logs remain at
`/tmp/safe-bash-tree-final-436bda3-k1mKIO`. The complete source/dependency manifests
and loaded-source copies are durable here. `coverage-index.json` hashes all raw
coverage retained in `/tmp`; broad coverage payloads are not duplicated here.
No source fix, staging, commit, public integration or safety-six-case execution.
