# Table command boundary correction

Task: `adapt-upstream-tables-bdd` only. Root owns
`packages/docx/src/structure-model-batch-operations.ts`,
`packages/docx/src/table-command-boundaries.test.ts`, this plan and
`docs/docx/table-command-evidence-20260915/`. Other workers own their assigned
variant tests, maps and table implementation. Preserve unrelated changes; no
README, later task, push or release.

## Test first

Two original tests fail before implementation: closed row slicing silently
coerces invalid bounds, and table self-owner lookup returns a detached table.
The direct SDK already rejects both. Delegate the declared slice action to the
checked model method and self-owner lookup to the validated model getter.
The third test exercises negative/exclusive-end row slicing through the full
SDK batch graph, with original two-row XML and immutable memfs input bytes.
An initial fixture-authoring error incorrectly passed a second argument to the
single-row fixture helper; it was corrected before the retained two-failure red
run. That error is not product-defect evidence.

The retained corrected red and focused green logs are in
`docs/docx/table-command-evidence-20260915/`. Fourteen focused tests pass.

## Language and security mappings

The SDK keeps zero-based checked `.slice(start,end)` with negative bounds and
exclusive end. The typed action remains `model.table._Rows.__getitem__.slice`;
ordinary table selectors are one-based. Missing/undefined bounds default,
invalid types (including null) raise InputTypeError. Detached receivers raise
StaleHandleError before returning metadata. No new method, alias, dynamic user
member dispatch or ambient authority is introduced. Public underscore owners
remain public. Common command schemas/envelopes/statuses remain shared with the
SDK. This correction does not independently qualify all 870 source case rows.

## Agent QA procedure

1. Inspect the retained corrected red run and exact invalid-bound assertions.
2. Run original table/structure command tests and maintained package checks.
3. Have an independent worker inspect the correction and test assertions.
4. Exercise row slicing through real safe-bash workflows in the separately owned
   shell qualification; capture and inspect terminal output when available.
5. Stage only named owned paths and commit locally on main after passing checks.

Renderer QA is not required for these model validation corrections; table layout
QA remains the explicit not-run procedure in docx-table-bdd-adaptation.md.
