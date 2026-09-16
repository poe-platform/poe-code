# PPTX fitting option boundary review

Scope: `packages/pptx/src/text-fitting.ts`, an original focused regression file,
and the matching research receipt. Existing unrelated files remain untouched.
No README, host capability, download, pipeline execution, push or release.

Completed procedure:

1. Read root instructions, the shared SDK/CLI contracts, PPTX specification,
   upstream API/test audit and inventories, and the current fitting receipts.
2. Reproduce explicit-null default substitution in the shared fitting validator:
   six original parameter cases failed before implementation.
3. Reject null for the six nonnullable defaulted controls before document
   admission. Preserve explicit undefined and supplied font metrics.
4. Verify the public SDK, CLI schema and pre-read argument rejection with a
   disposable in-memory filesystem. Check an independently calculated nondefault
   minimum (13 points), exact height (26 points at double spacing), and failure
   when raising the minimum to 14 points.
5. Run the focused fitting suite; coordinating agent runs maintained package
   validation and owns final atomic commit. No commit was made by this worker.

Observed focused check: `npx vitest run
packages/pptx/src/text-fit-option-boundaries.test.ts
packages/pptx/src/text-fitting.test.ts
packages/pptx/src/text-fit-public-arguments.test.ts
packages/pptx/src/command-text-fit.test.ts` passed 4 files / 41 tests.
The new test file executed in 19 ms. Corpus fixtures were unnecessary: this is
an original tiny metric/XML boundary regression, with no renderer claims.

Coordinator validation: maintained pptx lint passed, selected pptx workspace build
passed, and the package unit run passed 6,678 tests. Final new/corrected test
checks passed 113 tests; built adapter selector/script checks passed 45 tests.
Terminal help/errors were visually inspected. Details and execution boundaries
are recorded in `pptx-text-drawing-reconciliation.md`. Local commit only.
