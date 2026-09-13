# Image codec reconciliation

Scope: image utility/codec behavior, original tests, and exact research mapping.
Ownership: new `packages/pptx/src/image-codec-reconciliation.test.ts`,
`docs/pptx/image-codec-reconciliation*`, and this plan. Existing dirty media,
image replacement, schema, index and unrelated work remain untouched.

Read root rules, presentation/shared office specs, test/API audits and existing
image case ledgers; inspect pinned research source parametrization. Account for
138 shared codec rows, 32 presentation image utility rows and 16 direct image BDD
rows. Preserve notices separately; keep reference names solely in research.

Validation proceeds from original fast byte-array/memfs tests, then relevant
maintained package checks coordinated by the parent. No implementation bug was
found in the tested variants; add assertions without speculative product edits.
No visual output changed, so no screenshot campaign is needed for these tests.
No pipeline, corpus download, README edit, push or release is authorized here.

Execution receipt:

- Initial 50 original characterization/admission tests passed.
- Expanded 75 original tests passed, including SDK+CLI square scaling, six-format
  CLI insertion, exact tall scaling and unequal density native geometry.
- ESLint on the new test file passed.
- Final focused rerun, typecheck and parent maintained package checks are recorded
  below when complete. There is no claim of pixel decoding, actual rendering, or
  full format parity. EMF insertion remains explicitly unsupported while inert
  existing EMF byte extraction is covered by the existing original test suite.

Atomic commit candidate: `test(pptx): reconcile image codec behavior variants`.
No local commit is created by the delegated worker; parent owns staging/commit
serialization after maintained checks.

Final delegated validation:

- `npx vitest run` over image codec reconciliation, image value, metadata,
  admission, returned media model and image inventory: 6 files, 216 tests passed.
  The 75 new cases ran in 329 ms in that grouped execution.
- `npx vitest run packages/pptx/src/image-extraction.test.ts`: 36 tests passed,
  including inert EMF extraction; 112 ms test execution.
- `npx tsc -p packages/pptx/tsconfig.test.json --noEmit`: passed.
- `npx eslint packages/pptx/src/image-codec-reconciliation.test.ts`: passed.
- Ledger validation: 186 unique rows, every shared parametrized node has an
  explicit selected parameter payload or literal variant mapping. Counts are
  182 observable engine mappings, 2 language/security mappings and 2 explicit
  enhanced metafile insertion gaps. Whole-row parity stays false throughout.

Final root verification: maintained pptx workspace tests passed 6,654 cases in
250 files; workspace lint and selected workspace build closure passed. Five
focused actual safe-bash cases passed. Only explicitly owned files enter the
local atomic commit; no push or release.
