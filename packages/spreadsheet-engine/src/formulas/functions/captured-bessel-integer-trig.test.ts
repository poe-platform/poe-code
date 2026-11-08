import { expect, it } from "vitest";
import { recalculateWorkbook } from "../evaluator.js";

// Authenticated Gnumeric 1.12.61 / GOffice 0.10.61 on Linux arm64.
// Integer base functions must use the captured native trigonometric profile.
it.each([
  ["BESSELJ(9.99613777740196,1)", 0.044439258283272595],
  ["BESSELY(9.99613777740196,1)", 0.24889472349465738]
] as const)("matches native integer base evaluation within bounded work: %s", (formula, expected) => {
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
