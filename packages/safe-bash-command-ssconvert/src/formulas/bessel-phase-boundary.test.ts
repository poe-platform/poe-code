import { expect, it } from "vitest";
import { recalculateWorkbook } from "./evaluator.js";

// Unchanged Gnumeric 1.12.61 sf-bessel.c phase functions, compiled with
// goffice 0.10.62 on arm64. Source binding and scope: gap-resolution.json,
// reference.besselPhaseBoundary. The source warns only above 1 / DBL_EPSILON.
it.each<[string, number]>([
  ["=BESSELJ(1000000000001,0)", 7.208567448810501e-7],
  ["=BESSELY(1000000000001,0)", -3.420311765416154e-7],
  ["=BESSELJ(10000000000000,0)", 1.1926484739665656e-7],
  ["=BESSELY(10000000000000,0)", -2.2234629165383081e-7],
  ["=BESSELJ(10000000000000,0.5)", -7.288958824874797e-8],
  ["=BESSELY(10000000000000,0.5)", -2.415555529514611e-7],
  ["=BESSELJ(10000000000000,10)", -1.192648473977683e-7],
  ["=BESSELY(10000000000000,10)", 2.2234629165323445e-7],
  ["=BESSELJ(100000000000000,1)", 4.335345487723155e-8],
  ["=BESSELY(100000000000000,1)", 6.698265203680475e-8],
  ["=BESSELJ(100000000000000,23.5)", -7.801940940859291e-8],
  ["=BESSELY(100000000000000,23.5)", -1.6708365545743153e-8],
  ["=BESSELJ(1000000000000000,4)", 6.156638646884826e-9],
  ["=BESSELY(1000000000000000,4)", 2.4468665123771374e-8],
  ["=BESSELJ(4503599627370496,12)", 3.2676842967876922e-9],
  ["=BESSELY(4503599627370496,12)", 1.143154517899265e-8],
  ["=BESSELJ(10000000000000,-1.5)", 7.288958824872383e-8],
  ["=BESSELY(10000000000000,-1.5)", 2.415555529514684e-7],
  ["=BESSELJ(10000000000000,100000000000)", -2.4447238162966473e-7],
  ["=BESSELY(10000000000000,100000000000)", -6.243729009727955e-8],
])("keeps source phase dispatch through the precise argument boundary: %s", (formula, value) => {
  const result = recalculateWorkbook({ sheets: [{ id: "s", name: "S", cells: [
    { row: 0, column: 0, value: { kind: "blank" }, formula }
  ] }] }, { signal: new AbortController().signal, own() {},
    environment: { env: {}, locale: "C", timezone: "UTC" },
    limits: { inputBytes: 10000, outputBytes: 10000, cells: 1, sheets: 1, operations: 10000 } }, true);
  expect(result.sheets[0]!.cells[0]!.value).toEqual({ kind: "number", value });
});
