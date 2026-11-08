import { expect, it } from "vitest";
import { recalculateWorkbook } from "./evaluator.js";
import type { Diagnostic } from "../contracts.js";

// Unmodified Gnumeric 1.12.61 phase functions with goffice 0.10.62,
// clang -O2 -ffp-contract=fast on arm64 Darwin. These are source-profile
// results, including its documented loss of accuracy above 2^52.
it.each([
  [4503599627370496, 0, 3.267684296787875e-9, 1.1431545178992597e-8, 0],
  [4503599627370497, 0, -7.8537762192392634e-9, 8.9261517431049082e-9, 1],
  [4503599627370497, 12, -7.8537762192394056e-9, 8.9261517431047824e-9, 1],
  [1e20, 12, 6.6980090407034232e-12, -7.9506819824254498e-11, 1],
  [1e20, 1e18, 4.0491827940740997e-11, 6.8752657602849486e-11, 2],
  [1e150, 0, 6.7760206620041392e-76, -4.2127806998289311e-76, 2],
  [1e150, .5, 1.812484359062439e-76, -7.7702559600641314e-76, 2],
  [1e155, 0, NaN, NaN, 1],
  [1e300, 1e298, NaN, NaN, 1]
])("preserves phase results and warnings at x=%s, order=%s", (x, order, j, y, warnings) => {
  for (const [name, value] of [["BESSELJ", j], ["BESSELY", y]] as const) {
    const diagnostics: Diagnostic[] = [];
    const result = recalculateWorkbook({ sheets: [{ id: "s", name: "S", cells: [
      { row: 0, column: 0, value: { kind: "blank" }, formula: `=${name}(${x},${order})` }
    ] }] }, { signal: new AbortController().signal, own() {},
      environment: { env: {}, locale: "C", timezone: "UTC" },
      limits: { inputBytes: 10000, outputBytes: 10000, cells: 1, sheets: 1, operations: 10000 } }, true,
    diagnostic => diagnostics.push(diagnostic));
    expect(result.sheets[0]!.cells[0]!.value).toEqual(Number.isNaN(value)
      ? { kind: "error", value: "#NUM!" } : { kind: "number", value });
    expect(diagnostics).toHaveLength(warnings!);
    for (const diagnostic of diagnostics) expect(diagnostic).toMatchObject({
      code: "numeric-warning", severity: "warning", message: "Reduced accuracy for very large trigonometric arguments"
    });
  }
});
