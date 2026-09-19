# csvgrep domain user edge QA

Use in-memory inputs and explicit injected capabilities; do not write fixtures,
invoke native programs, or query networks or databases.

1. Run `npx vitest run packages/csvkit/src/csvgrep.test.ts`.
2. Compare exact stdout, stderr and status for empty substring and regex patterns
   across AND/OR and inversion. Empty predicates preserve vacuous aggregation.
3. Verify an empty regex falls through to match-file membership, then substring
   when no match file is supplied.
4. Exercise duplicate selectors and reversed ranges under both aggregate modes
   and inversion. Preserve source dictionary standardization and empty selection.
5. Filter after a multiline quoted record with line numbering, and verify the
   surviving row uses its original physical input position. Repeat without a
   header and verify generated headers include the numbering column.
6. Run maintained csvkit package test, lint and selected workspace build closure.
7. Run the independent safe-bash user edge suite and existing command stress suite.

The four added domain regressions pass against the existing implementation;
they do not reproduce a defect and therefore justify no product change. They are
source-driven expectations, not new frozen native differential observations.
Full Python regex compatibility and existing unimplemented command paths remain
explicit blockers. Skipped and TODO cases are not passes.

Observed validation: the csvgrep domain file passes 21 tests; the full csvkit
workspace passes 1,682 tests with one skipped and six TODO cases. Package lint
and the selected maintained build closure pass. Existing safe-bash csvgrep
stress and csvkit integration files pass 18 tests; the independent new user
edge file passes six tests. The maintained integration inventory tests pass
109 cases. Focused ESLint passes for the changed test/inventory files. The
independent reviewer reproduced no product defect. No product source changes,
README additions, commits, pushes or publication occurred in this review.
