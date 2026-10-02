import { expect, it } from "vitest";
import { recalculateWorkbook } from "../evaluator.js";

// Authenticated Gnumeric 1.12.61 / GOffice 0.10.61 on Linux arm64.
// These values use the source Algorithm A4 domain, where order is close to x.
it.each([
  ["BESSELJ(17,13.143077614012647)", 0.14389391866307372],
  ["BESSELY(17,13.143077614012647)", 0.19325036379365362],
  ["BESSELJ(397.00181673880354,397)", 0.06087496590419358],
  ["BESSELY(397.00181673880354,397)", -0.1053916146970726],
  ["BESSELJ(119.76295241216197,114.05316059516413)", 0.12234285287191059],
  ["BESSELY(119.76295241216197,114.05316059516413)", 0.04379676180889577],
  ["BESSELJ(228.99152432038971,229)", 0.07301974410419348],
  ["BESSELY(228.99152432038971,229)", -0.12679855855882266],
  ["BESSELJ(1000,1000)", 0.04473067294796406],
  ["BESSELY(1000,1000)", -0.0774760015207208]
] as const)("matches native near-order quadrature within bounded work: %s", (formula, expected) => {
  const book = recalculateWorkbook(
    {
      sheets: [
        {
          id: "s",
          name: "S",
          cells: [{ row: 0, column: 0, formula: "=" + formula, value: { kind: "blank" } }]
        }
      ]
    },
    {
      own() {},
      signal: new AbortController().signal,
      environment: { env: {}, locale: "C", timezone: "UTC" },
      limits: {
        inputBytes: 10000,
        outputBytes: 10000,
        cells: 1,
        sheets: 1,
        operations: 1000,
        workbookWork: 5000
      }
    },
    true
  );
  expect(book.sheets[0]!.cells[0]!.value).toEqual({ kind: "number", value: expected });
});
