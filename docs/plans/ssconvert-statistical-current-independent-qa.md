# Statistical tools: current independent stress QA

Executed 2026-09-21 by the independent stress agent. Root owns final build,
Safe Bash integration, native comparison, screenshots and Git. No push or release.

## Procedure executed

1. Read root and Safe Bash AGENTS.md; no scoped ssconvert AGENTS.md exists.
2. Inspect current statistical/utilities implementation and original small
   in-memory fixtures through the actual command/SDK engine with memfs byte I/O.
3. Audit extracted primary source under `out/ssconvert-lifecycle/gnumeric-1.12.61`:
   `src/criteria.c`, `src/cell.c`, `src/value.c`, `src/tools/fill-series.c`.
4. Add each new regression first and observe its failure before fixing product code.
5. Run focused Vitest files and maintained ssconvert workspace lint, including
   source and test TypeScript checks. No unit test writes host files, spawns native
   utilities or queries LLMs.

## Validated findings and fixes

- Field names fold ASCII only: `Ärea` versus `ärea` must be invalid, while
  `ÄREA` versus `Ärea` matches. Before fix, the invalid case copied records;
  Gnumeric uses `g_ascii_strcasecmp`. Replaced Unicode case folding locally.
- A present empty STRING criteria value must remain a blank-value condition.
  Before fix it was discarded and a nonempty record matched. Gnumeric
  `gnm_cell_is_empty` checks VALUE_EMPTY only; criterion parsing distinguishes
  an empty STRING. Skip only blank values.
- Numeric field index one binary64 step below one must snap to one. Before fix
  `0.9999999999999999` produced invalid criteria. Gnumeric `value_get_as_int`
  calls `gnm_fake_trunc`; reuse the existing SDK fakeTrunc helper.

Independent positive/negative controls accompany the first finding. An unequal
sample-size fixture independently verifies counts, pooled variance `48/5`,
equal-model df `5` and Welch df `147/31`. The initial test expectation incorrectly
used `56/5`; this was an arithmetic error in the new QA test, corrected without
product changes after calculating sample variances `4` and `40/3`.

## Coverage and results

All 15 requested tools have separate operation-budget rejection and abort-reason
identity checks; every rejected run preserves the original workbook. The literal
inventory is chi-squared-test, sign-test, sign-test-two-samples, one-mean-test,
wilcoxon-signed-rank-test, wilcoxon-signed-rank-test-two-samples,
wilcoxon-mann-whitney, f-test, t-test-paired, t-test-equal-variances,
t-test-unequal-variances, kaplan-meier, z-test, advanced-filter and fill-series.

Focused command:

`npx vitest run packages/ssconvert/src/analysis/statistical-current-independent.test.ts packages/ssconvert/src/analysis/tests-utilities.test.ts packages/ssconvert/src/analysis/tests-utilities-independent.test.ts`

Final result: 3 files, 131 passing executions, zero failures/skips/incomplete
runs. Importing the preexisting `moments.test.ts` helper registers 21 moments
tests in each file: 63 executions are duplicated imported moments coverage,
68 executions cover the targeted tools. New independent coverage is 19 tests
(3 filter regressions, 1 unequal-size variance fixture, 15 boundary cases).

`npm run lint --workspace=@poe-code/ssconvert` passed after the first, second and
third fixes, including source ESLint, source tsc and test tsc.

Verified live candidate SHA-256:

- utilities.ts: `af79805a5c769321212f88a834e867a069a015925144fa3d17e6a2f589180b48`
- statistical-current-independent.test.ts: `1c2784855afc090e1e54acb3cfbfb865f31ee0ff772720eda0fb78044129a2e7`
- unchanged statistical.ts: `9dcfd33fce4d58049713c838194ffd873508b029533b55586b1eb926bbada103`

No deterministic performance claim is made from the reported test timings.
These checks use the live worktree, not an authenticated committed archive.
Unsupported tools, native matrix variants, locale/plugin dependency profile,
Safe Bash realms, checkpoint/replay, packed consumers, screenshots, full-root
checks and final build are outside this independent run and remain unverified
here. Root's separate gates must record their own results. GUI grouping for
Kaplan-Meier is not established by the empty CLI group-list path.

## Owned paths

- `packages/ssconvert/src/analysis/utilities.ts`
- `packages/ssconvert/src/analysis/statistical-current-independent.test.ts`
- This QA document.
