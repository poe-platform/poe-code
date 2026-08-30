# Replay the exact candidate archive, not live product inputs

Use the immutable candidate commit from the requested prototype receipt. From
the repository root, set `candidate` to that full commit and run:

```sh
artifact=tests/commands/expr-stress/nullable-hierarchy-v5-20260827/prototype
scratch=$(mktemp -d "${TMPDIR:-/tmp}/expr-v5-review.XXXXXX")
git archive "$candidate" "$artifact" | tar -x -C "$scratch"
node "$scratch/$artifact/verify.mjs" "$PWD"
rm -rf "$scratch"
```

The verifier reads immutable historical Git blobs and three live guarded product
files only for hashes. It does not import or execute any product source or dist.
It authenticates every candidate entry, runs the archived prototype, compares
its JSON to `run-01.data`, and checks complete entry inventories and guards again.
New files/directories/symlinks within the archive are detected. The three-file
live guard is explicitly not an append-proof source-tree audit. Concurrent root
or unrelated source changes do not enter this archive.

`run-prototype.mjs` defaults to stdout with no writes. Its intentional exit1
means six preserved policy-target conflicts, not six implementation-prediction
failures. `verify.mjs` exits0 only for an authentic reproduction with zero failed
implementation/control checks; this is not policy acceptance. Optional capture:
`node run-prototype.mjs --capture /absolute/unique/output.data`; the parent must
already exist outside the artifact. Exclusive create refuses any existing file.

Artifact API: `HistoryModel(spec, subject, options?)`,
`build(plan, 'FINITE-PERMISSIVE' | 'LOCAL-TAIL-HYPOTHESIS')`,
`compare(left, right, 'HNODE-AGG-v5' | 'HTREE-AGG-v5')`, and `rank` with the same
policy. `validateFrozen(history, fixture)` checks every close, intermediate env
and reference-origin expectation. History operands must belong to that model.
No public package API is introduced. Direct arbitrary event replay or activation
renaming is unsupported; reconstruction neutrality is checked on supplied W4.

Later handoff reporting may add files to the live prototype subtree. Such files
are not silently excluded by the candidate verifier: archive the sealed commit,
not a later HEAD or a live overlay. Immutable attempt-source `.data` files are
bound inert evidence, never modules executed by this runner.
