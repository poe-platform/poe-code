import { expect, it } from "vitest";
import { recalculateWorkbook } from "@poe-code/spreadsheet-engine/formulas/evaluator";
import { translateBiffFormula } from "./biff-formulas.js";

function number(value: number): number[] {
  const bytes = new Uint8Array(9);
  bytes[0] = 0x1f;
  new DataView(bytes.buffer).setFloat64(1, value, true);
  return [...bytes];
}

// Original RPN streams deliberately omit PtgParen: operand structure already
// determines operation order. Reconstructing text must retain that structure.
it.each([
  ["right addition", [...number(1e16), ...number(-1e16), ...number(1), 3, 3], 0],
  ["right subtraction", [...number(1e16), ...number(1e16), ...number(1), 4, 3], 2e16],
  ["right multiplication", [...number(1e308), ...number(1e-308), ...number(1e-308), 5, 5], 0],
  ["right division", [...number(1e308), ...number(1e308), ...number(1e308), 6, 5], 1e308],
  ["left exponent", [...number(2), ...number(3), 7, ...number(2), 7], 64],
  ["right exponent", [...number(2), ...number(3), ...number(2), 7, 7], 512],
  ["negative number base", [...number(-2), ...number(2), 7], 4],
  ["negated base", [...number(2), 0x13, ...number(2), 7], 4],
  ["negated exponent result", [...number(2), ...number(2), 7, 0x13], -4],
  ["left addition control", [...number(1e16), ...number(-1e16), 3, ...number(1), 3], 1]
] as const)("preserves %s in every supported BIFF revision", (_name, tokens, expected) => {
  for (const revision of [2, 3, 4, 5, 7, 8]) {
    const formula = translateBiffFormula(new Uint8Array(tokens), {
      revision, codepage: 1252, row: 0, column: 0, names: [], externalSheets: [], limit: 10000
    });
    const book = recalculateWorkbook({ sheets: [{ id: "S", name: "S", cells: [
      { row: 0, column: 0, formula, value: { kind: "number", value: 999 } }
    ] }] }, {
      own() {}, signal: new AbortController().signal,
      environment: { env: {}, locale: "C", timezone: "UTC" },
      limits: { inputBytes: 10000, outputBytes: 10000, cells: 10, sheets: 1, operations: 1000 }
    }, true);
    expect(book.sheets[0]!.cells[0]!.value, formula).toEqual({ kind: "number", value: expected });
  }
});
