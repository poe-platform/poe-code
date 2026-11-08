import { expect, it } from "vitest";
import { recalculateWorkbook } from "../evaluator.js";

// Authenticated Gnumeric 1.12.61 / GOffice 0.10.61 on Linux arm64.
// These values use the source Algorithm A2 domain, where order exceeds x.
it.each([
  ["BESSELJ(406.16475070692996,427.5453392875886)", 0.00033796503146569926],
  ["BESSELY(406.16475070692996,427.5453392875886)", -7.079824998285399],
  ["BESSELJ(120.60286643316502,150.75945371221994)", 3.313767748920805e-8],
  ["BESSELY(120.60286643316502,150.75945371221994)", -106222.22375356099],
  ["BESSELJ(87.3660019079475,109.21258122978006)", 0.0000018641141271247334],
  ["BESSELY(87.3660019079475,109.21258122978006)", -2607.4259484211184]
] as const)("matches native transition quadrature within bounded work: %s", (formula, expected) => {
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

import { capturedBesselTransition } from "./captured-bessel-transition.js";
it("propagates the original interruption while shrinking the quadrature range", () => {
  const reason = new Error("interrupted");
  let ticks = 0, caught: unknown;
  try {
    capturedBesselTransition(406.16475070692996, 427.5453392875886, true, {
      tick() { if (++ticks === 4) throw reason; }
    });
  } catch (error) { caught = error; }
  expect(caught).toBe(reason);
  expect(ticks).toBe(4);
});
