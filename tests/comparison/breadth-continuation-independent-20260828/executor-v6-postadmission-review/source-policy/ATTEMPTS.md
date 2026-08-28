# DATA checker execution history

## Attempt 1 — tooling defect, not a product result

Command: `node tests/comparison/breadth-continuation-independent-20260828/executor-v6-postadmission-review/source-policy/check-source.mjs`

Presealed checker commit: `35d39a23`. Node reported `v22.22.2`; exit 1.
After metadata authentication and reading the 21 admitted source files, the
checker used an incorrect in-memory map key for the fallback chunk: it omitted
the `chunks/` directory. `digest(undefined)` threw `ERR_INVALID_ARG_TYPE` at
checker line 101. No comparator execution or prohibited access occurred.
No CHECK-RESULTS.json was created, no AST checks ran, and the failed attempt did
not reach its source-after-hash loop. It is not counted as a passing check run.

Correction: use the path already present in authenticated OBSERVATIONS.json,
`benchmarks/node_modules/just-bash/dist/bundle/chunks/chunk-NCUTH6QL.js`.
The expected fallback hash, all expected checks and the 21-source scope remain
unchanged. Add the existing offline guard's `regular-read.mjs` helper to immutable
Git authentication for the already-presealed asset-guard source review.
The original checker is preserved by commit `35d39a23`; this correction is
committed before attempt 2. No prior artifact is rewritten.
