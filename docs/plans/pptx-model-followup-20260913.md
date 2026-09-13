# Chart builder numeric lookup followup

Owned scope: `packages/pptx/src/chart-data-model.ts`, original
`chart-data-indexing.test.ts`, this plan and the matching evidence receipt.
Root instructions apply; no more-specific package instructions exist. Preserve
all initially dirty files and avoid edits to the shared command entry points.

1. Read the shared CLI/SDK contracts and pinned API/test inventories.
2. Demonstrate the violation of the explicit negative `.at(index)` JavaScript
   mapping using the public chart builder exports, inherited collections and the
   documented `ChartData` alias.
3. Reject negative bracket indexes in the existing collection implementation;
   retain supported negative `.at` and `.slice` behavior.
4. Run original focused tests, existing typed chart command integration tests,
   and package lint/type checks. Record exact results in `docs/pptx`.

Agent QA: inspect the patch for accidental ownership changes and compare error
classes and collection membership before/after failed access. No screenshot is
needed for this JavaScript protocol-only change; CLI appearance is unchanged.
Do not introduce a CLI command merely to emulate JavaScript indexing. No corpus,
native runtime, network or fixture cleanup is needed. The root agent owns commits.

Completed: the original regression failed before the two-line domain correction;
58 focused model/command tests and 16 additional typed command tests pass.
`npm run lint --workspace=pptx` passed all maintained ESLint and TypeScript stages.
The exact mapping and bounded limitations are recorded in
`docs/pptx/model-followup-evidence-20260913.md`.
# Final integration receipt

Root verification: maintained PPTX build closure passed; package unit rerun
passed 6,821 tests in 260 files; package lint/type checks passed. Actual shell
selector/chart integration passed 49 tests. These are scoped package results,
not a whole-public-API conformance claim. Local commit only; no push or release.
