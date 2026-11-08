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

## Attempt 2 — completed original check, 25/26 pass

Corrected checker commit: `0be1a18a`. The same command exited 1 and exclusively
created CHECK-RESULTS.json (30525 bytes). All 21 sources parsed and retained their
before/after hashes. The one failed expectation was the raw token total: 3, not
1. The main executable property access remains at byte 503554. Two additional
string-literal mentions had already been recorded in Raman's diagnosis.
This is an independent preseal error, not an error in that prior token inventory.

## Supplemental classification — 3/3 pass

Preseal/checker commit: `ef136fa811ebe3165612b3f237be4038745211b4`.
Command: `node tests/comparison/breadth-continuation-independent-20260828/executor-v6-postadmission-review/source-policy/check-secondary.mjs ef136fa811ebe3165612b3f237be4038745211b4`

Exit 0; SECONDARY-RESULTS.json exclusively created (100864 bytes). Exactly one
Identifier/property access and two StringLiterals classified, complete e/t/Ks
reference counts confirmed, fallback export a→m confirmed. The original 25/26
result remains unchanged, not retroactively passing. Supplemental contextual
spelling/substring lists are explicitly not symbol or reachability proof; the
final extraction preseal narrows the human-reviewed context to named methods.

## Final DATA cross-check — completed

Preseal/checker commit: `2c86b9c5`.
Command: `node tests/comparison/breadth-continuation-independent-20260828/executor-v6-postadmission-review/source-policy/check-final-data.mjs`

Exit 0; FINAL-DATA-RESULTS.json exclusively created (27367 bytes). 21/21 actual
load records agree with config and source; 36/36 previously authenticated inputs
retain their before/after hashes. Bounded named-method excerpts are source data,
not executed controls. No engine executions, builtin probes or archive reads.
