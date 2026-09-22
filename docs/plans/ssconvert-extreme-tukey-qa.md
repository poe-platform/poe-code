# Extreme logarithmic Tukey inverse QA

This numerical stress vector performs expensive quadrature and exceeds the fast
unit-test budget. Execute it manually when changing Tukey distribution or inverse
calculation. The normal logarithmic inverse, quadrature work-limit, and cancellation
checks remain in the unit suite.

1. From the existing checkout, use an ES module invocation
   (`node --import tsx --input-type=module`) and import `recalculateWorkbook`
   from `packages/ssconvert/src/index.ts`.
2. Create an in-memory workbook with one sheet and one numeric cell at row 0,
   column 0. Give the cell formula `=R.QTUKEY(-1000,3,10,1,TRUE,TRUE)` and set
   `formulaDirty: true`.
3. Recalculate with a live abort signal, locale `C`, timezone `UTC`, empty
   environment, and limits of 100000 input/output bytes, 10000 cells, 2 sheets,
   10000 operations, and 1000000 workbook work units. No filesystem capabilities
   are needed.
4. Confirm the resulting cell has kind `number` and expected value
   `7.186959238596909e-108`, with relative error
   `Math.abs(actual / expected - 1) < 2e-14`.
5. Record the result and elapsed time in delivery evidence. Allow this manual
   calculation to finish without extending the unit-test timeout.
