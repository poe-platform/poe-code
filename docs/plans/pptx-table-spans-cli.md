# Table span command integration

Scope: package byte SDK and registered virtual shell commands for rectangular
merge/split and explicit span-aware row/column insertion/deletion. Domain ownership
is in `packages/pptx/src/table-spans.ts`; command parsing and publication use the
existing engine. No host I/O or downloaded unit fixtures.

Validation procedure:

1. Run original memfs command regressions and require the initial unsupported merge
   failure before adding command registration.
2. Verify one-based CLI coordinates convert to zero-based domain coordinates;
   required expand/reject or shrink/reject policies fail before publication.
3. Compare registered shell output bytes with explicit byte SDK results and assert
   independent text/grid dimensions. Check partial-intersection rejection and
   unchanged failed mutation input bytes.
4. Compile exposed schemas; run focused package tests/lint and registered shell
   tests after rebuilding the package. Inspect generated help through the existing
   screenshot route without adding screenshot tests.

Initial red evidence: `command-tables.test.ts` merge returned usage exit 2 where
success was required. Existing eight table command tests passed.

The existing `tests/commands/pptx/tables.test.ts` literal registration in
`packages/safe-bash/scripts/integration-inputs.test.mjs` covers the additional
registered shell cases. No new test path or inventory exclusion is introduced.

Validation receipt:

- `npx vitest run packages/pptx/src/command-tables.test.ts`: 11 passed, including
  all six structural routes and schema/result validation.
- `npm run lint --workspace=pptx`: passed after domain lint corrections.
- From `packages/safe-bash`, `node --import tsx --test
  tests/commands/pptx/tables.test.ts`: 5 passed through the registered Shell.
- The workspace npm test wrapper appends the entire discovered inventory even
  with a literal operand; that invocation was stopped and is not passing evidence.
  The literal node:test route above supplies the focused shell evidence.

SDK structural options reject accessors, missing operations, unrelated formatting
updates and cell selectors inconsistent with the split origin before input reads.
The CLI retains one-based row,column split selection; current opaque tokens name
tables, so a split cell uses simple selectors. Merge accepts a table token with
explicit from/to coordinates. No cell selector applies to row/column operations.
