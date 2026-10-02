import { expect, it } from "vitest";
import { recalculateWorkbook } from "../evaluator.js";

// Authenticated Gnumeric 1.12.61 / GOffice 0.10.61 on Linux arm64.
// These values use the source Debye B2 domain, where order exceeds x.
it.each([
  ["BESSELJ(17,42.71281590658235)", 4.5219054449074565e-14],
  ["BESSELY(17,42.71281590658235)", -179660669896.0961],
  ["BESSELY(100,524)", -5.332710761680219e307],
  ["BESSELJ(20.14335363245981,201.47587278385765)", 3.8555810760186273e-177],
  ["BESSELY(20.14335363245981,201.47587278385765)", -4.1183075661177754e173],
  ["BESSELJ(233.6385518712982,467.2949946488588)", 5.9782378655227629e-94],
  ["BESSELY(233.6385518712982,467.2949946488588)", -1.3156799583587506e90],
  ["BESSELJ(161.3246847332165,322.64191092333084)", 1.566647453481022e-65],
  ["BESSELY(161.3246847332165,322.64191092333084)", -7.2716354384444026e61],
  ["BESSELJ(95.49343703509938,-191)", -1.2059396766058975e-39],
  ["BESSELY(95.49343703509938,-191)", 1.5957113857170881e36]
] as const)("matches native high-order expansion within bounded work: %s", (formula, expected) => {
  const book = recalculateWorkbook({ sheets: [{ id: "s", name: "S", cells: [
    { row: 0, column: 0, formula: "=" + formula, value: { kind: "blank" } }
  ] }] }, { own() {}, signal: new AbortController().signal,
    environment: { env: {}, locale: "C", timezone: "UTC" },
    limits: { inputBytes: 10000, outputBytes: 10000, cells: 1, sheets: 1, operations: 1000, workbookWork: 5000 }
  }, true);
  expect(book.sheets[0]!.cells[0]!.value).toEqual({ kind: "number", value: expected });
});
