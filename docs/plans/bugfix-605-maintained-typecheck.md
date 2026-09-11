# #605 maintained-test typecheck corrections

## Scope and ownership

September 4, 2026. Bounded correction against root baseline
`6bba02cfb1a332ccdf84b3c8dd8f184b89a32616`: only the current jq evidence
verifier, invocation-cleanup contract cases, and this plan. Root owns the
remaining retired-module resolution investigation, full gates, commits and
delivery. #605 remains open until all 24 baseline diagnostics are resolved
and the fix is pushed.

## Admission and immutable evidence

The current jq verifier's pre-edit SHA-256 is
`176ef3376055db4c3ef5846057bf1bcd06bd123fec0ae00cfb676776afa08d22`;
no tracked hash reference was found. The cleanup cases' pre-edit SHA-256 is
`6fd7328d89b47a3b1277f92b90b053ed0953bbb930daaa75106520aed3c60339`;
its only tracked hash reference is the historical cohort identity in
`docs/plans/contract-test-cohort.md`, not a live byte seal.

The original jq snapshot remains outside the edit scope:
`packages/safe-bash/tests/commands/structured-stress/jq-grammar-seal-proposal/before-2026-08-27/evidence.test.ts.txt`,
SHA-256 `bc2b19133b926eccf2519885bb5ca7a16f9ce09e1fb1a9cda78b6c365a7710f8`.
No fixtures, receipts, sealed comparisons, or historical bytes are changed.

## Correction

- Assert receipt-member existence before its field comparisons.
- Assert the historical expected digest is a string before constructing the
  control; retain the existing predecessor/immutable-evidence selection.
- Assert byte existence before each first-byte XOR negative control. Preserve
  the same XOR, buffer copies, rejection assertions and snapshot comparisons.
- Include the already-present `argumentValues` property in the exact
  `CommandInvokeOptions` key-union test; do not change production contracts.

No casts, non-null assertions, suppression directives, input exclusions,
restored native executors or companion type models are added.

## TDD evidence

Logs are private, outside the repository, under
`/home/kjopek/kamilio-validation-569-575.RoFXyZ/605-current-tests/`.
Commands use Node 22 from `/tmp/kamilio-toolchain.path`, the private home
TMPDIR, `TSX_DISABLE_CACHE=1`, unset `NO_COLOR`, and cleared child Git-local
variables. No build, native execution or broad gate is run.

RED: `types-red.log`, exit 1, 11 diagnostics. A no-emit TypeScript program
uses the package's unchanged compiler options and the two approved tests
as roots (including their imports). Ten diagnostics identify unchecked
receipt/digest/byte accesses in the current evidence verifier; one identifies
the stale exact contract key union. This is a focused diagnostic reproduction,
not a replacement for the maintained full-input typecheck.

GREEN: `types-green.log`, exit 0, zero diagnostics with the exact same focused
roots and compiler options, no emit. Node version: `v22.22.0`.

Canonical runtime checks, from `packages/safe-bash`:

```sh
node --import tsx --test --test-concurrency=1 tests/commands/structured-stress/jq-42-review-fixes/evidence.test.ts tests/contracts/invocation-cleanup.cases.ts
```

`runtime-green.log`: exit 0, 51 tests passed, zero failures, cancellations,
skips or todos. The verifier reports 140 live comparisons, 136 unchanged
comparisons, four spelling migrations, 23 historical snapshots, one
unused-binding migration and 135 byte-unchanged comparisons.

## Frozen handoff

Only the two authorized current tests and this plan were edited. Their
focused checks are GREEN; no further edits are planned without authorization.
Final test SHA-256 values:

- `packages/safe-bash/tests/commands/structured-stress/jq-42-review-fixes/evidence.test.ts`:
  `e560a3c9085fcaeb15a491d7a10d4b9932864f647b90aa0721c728436791e841`.
- `packages/safe-bash/tests/contracts/invocation-cleanup.cases.ts`:
  `d3f6ca504d64cc7ed96464a3e37bf6b5e05ae3de3764deaefdc568c0093ec008`.

The original jq snapshot SHA-256 was rechecked after validation and remains
`bc2b19133b926eccf2519885bb5ca7a16f9ce09e1fb1a9cda78b6c365a7710f8`.

## Limits

This change does not claim to resolve the other 13 baseline diagnostics,
establish a clean maintained full-input typecheck, or validate retired native
execution. Full-input membership and existing retirement policy are unchanged.
No commit, push, release, broad-gate, resource-stress or performance claim.
