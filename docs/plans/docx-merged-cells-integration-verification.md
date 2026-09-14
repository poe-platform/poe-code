# DOCX merged-cell integration verification

Current task: `merged-cell-operations`, test step only. Root owns Git and overall
task status. This leaf owns this record and
`docs/docx/merged-cell-case-verification.json`; it owns no product edits. Existing
pipeline edits and staging are preserved. No README, push or release work.

## Integration and export inspection

The explicit `docxCommands({ engine })` plugin passes literal owned argument
bytes, streams, filesystem, cancellation and invocation cleanup to the supplied
engine. It remains absent from default aggregate commands. The matching root and
`virtual-bash` leaf exports retain their runtime, browser and declaration routes.
`virtual-bash` runtime dependencies remain empty. No export change is needed.

The existing `tests/commands/docx/tables.test.ts` is registered by exact literal
path in `packages/safe-bash/scripts/integration-inputs.test.mjs`. Historical
membership and seals were not changed. Its merged-cell test exercises a 2x2
merge, exit-1 covered-coordinate write rejection with unchanged memfs bytes,
then split with exact original numeric-looking text recovery. Other existing
tests cover command opt-in, collisions, literal byte arguments, structured
grammar, binary streams, cancellation and publication capability boundaries.

## Checks and their limits

Initial checkout: `main`, product commit `7cc487c1`; only the pipeline plan was
modified and the index was empty. The later marker correction belongs to root's
commit `8943f8923fc3c9cf8081c319ccb7eede291676ef` and is independently reviewed.

- Focused command, before that correction:
  `TSX_DISABLE_CACHE=1 node --import tsx --test packages/safe-bash/tests/commands/docx/io.test.ts packages/safe-bash/tests/commands/docx/xml-parts.test.ts packages/safe-bash/tests/commands/docx/sections.test.ts packages/safe-bash/tests/commands/docx/tables.test.ts packages/safe-bash/tests/commands/docx-registration.test.ts`:
  47 passed, zero skipped. Log:
  `/tmp/docx-merged-test-step-shell-20260914.log`.
- The same focused command was rerun after marker-fix commit `8943f8923` and
  its maintained document dependency build: 47 passed, zero skipped. Log:
  `/tmp/docx-merged-test-step-shell-corrected-20260914.log`.
- `npm run test:runner --workspace=virtual-bash`: 515 passed, zero skipped.
  Log: `/tmp/docx-merged-test-step-runner-20260914.log`.
- `npx vitest run scripts/docx-exports.test.ts`: two passed. This checks export
  mappings and the portable document bundle, not installed-consumer runtime or
  all public object-model behavior. Log:
  `/tmp/docx-merged-test-step-exports-20260914.log`.
- `npm run typecheck:all --workspace=virtual-bash`: passed; one build, source and
  tests, historical consumer, three source-consumer groups, 26 current-consumer
  groups, and three exact negative diagnostic suites. Zero runtime executions.
  Log: `/tmp/docx-merged-test-step-typecheck-all-20260914.log`.
- An earlier `npm run typecheck --workspace=virtual-bash` overlapped that rebuild
  and returned status 2 despite all printed compiler phases returning 0. The
  invocation did not request a report, so the precise caught consumer assertion
  is unavailable. Declaration binding drift during rebuild is an inference,
  not a diagnosed product defect. The failed log remains preserved at
  `/tmp/docx-merged-test-step-typecheck-20260914.log`.
- A subsequent sequential
  `npm run typecheck --workspace=virtual-bash -- --report /tmp/docx-merged-test-step-typecheck-stable-report-20260914`
  passed without rebuilding. All 26 current groups pass and the three negatives
  retain exact 1/2/5 diagnostic counts. Its report and
  `/tmp/docx-merged-test-step-typecheck-stable-20260914.log` retain the actual
  assertions. No typecheck failure reproduced and no product change was made
  for the earlier overlapping invocation.

The focused direct node command is scoped runtime evidence, not the full
maintained workspace unit gate. The current maintained `virtual-bash` test
runner discovers all active test files and does not implement a focused
`SAFE_BASH_TEST_RG` selection. Root explicitly selected direct focused files plus
maintained runner and typechecking checks for this task. No full safe-bash,
full-repository, packed-runtime or release gate is claimed.

## Case accounting

The research supplement retains all 71 assigned source identities and bound
parameters: 48 unit cases and 23 expanded behavior examples. Historical
inventories are unchanged. The supplement now maps each row to an original test
title and parameter case, with case-specific rationale and shared-case references.
Independent review accepts 71 utility-mapped qualifications over 63 new original
parameterized tests; this is not literal source parity or complete live-table API
implementation. Six deliberate contract differences, one private-call-trace
replacement and one deferred live-method obligation retain explicit dispositions.
Live getters and other model obligations remain visible separately.

The complete package run passed 1,635 tests in 62 files before assertion-only
refinements. The final 24 geometry/empty-cell/selected-width assertions and three
pre-mutation span assertions were then rerun: 24 passed / 1,611 deselected, and
3 passed / 1,632 deselected respectively. Final package ESLint and source/test
typechecks also passed. These are combined evidence, not a claim of one complete
full-package run over the final assertion bytes. Commands and SHA-256 bindings
for product, original tests, source inventory and retained logs are in the
research supplement. New variants verify existing behavior; no historical red
phase is fabricated for passing verification-only cases. The initial wrong
reversed-corner error expectation is documented as a test correction, separate
from the independently reproduced and fixed range-marker defect.

No downloaded fixture was opened, modified, acquired or deleted. Corpus census
and reference baseline passes remain preparation. Original memfs fixture runs
are product evidence only for the operations actually asserted. No Word-page
rendering, complete upstream adaptation or whole live-table API is claimed.
