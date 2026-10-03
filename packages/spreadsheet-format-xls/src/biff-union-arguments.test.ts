import { expect, it } from "vitest";
import { recalculateWorkbook } from "@poe-code/spreadsheet-engine/formulas/evaluator";
import { parseExpression } from "@poe-code/spreadsheet-engine/formulas/parser";
import { translateBiffFormula } from "./biff-formulas.js";
import { BiffFormulaWriter } from "./biff-write-formulas.js";

it.each(["fixed", "variable", "custom", "nested", "parenthesized", "attribute"] as const)("retains one union operand in a %s function call", kind => {
  for (const revision of [2, 3, 4, 5, 7, 8]) {
    const ref = (row: number) => [0x24, row, 0, 0, ...(revision >= 8 ? [0] : [])];
    const name = kind === "custom" ? [0x17, 5, ...(revision >= 8 ? [0] : []), 65, 82, 69, 65, 83] : [];
    const index = kind === "custom" ? 255 : 75;
    const fixed = kind === "fixed" || kind === "nested" || kind === "parenthesized";
    const fn = kind === "attribute" ? [0x19, 0x10, 0, ...(revision >= 3 ? [0] : [])] :
      [fixed ? 0x21 : 0x22, ...(fixed ? [] : [kind === "custom" ? 2 : 1]), index, ...(revision >= 4 ? [0] : [])];
    const formula = translateBiffFormula(new Uint8Array([...name, ...ref(10), ...ref(11), 0x10,
      ...(kind === "nested" || kind === "parenthesized" ? [...(kind === "parenthesized" ? [0x15] : []), ...ref(12), 0x10] : []), ...fn]), {
      revision, codepage: 1252, row: 0, column: 0, names: [], externalSheets: [], limit: 10000
    });
    const parsed = parseExpression(formula, { position: { sheet: "S", row: 0, column: 0 } });
    // Retain original PtgParen in addition to the set syntax wrapper. Native
    // XLSX reimport rejects this spelling even after its own export.
    if (kind === "parenthesized") expect(formula).toBe("=AREAS(((($A$11,$A$12)),$A$13))");
    expect(parsed.ok).toBe(true);
    if (!parsed.ok || parsed.document.root.kind !== "call") throw new Error("Expected imported function call");
    expect(parsed.document.root.args, formula).toHaveLength(1);
    const book = recalculateWorkbook({ sheets: [{ id: "S", name: "S", cells: [
      { row: 0, column: 0, formula, value: { kind: "number", value: 999 } }
    ] }] }, {
      own() {}, signal: new AbortController().signal,
      environment: { env: {}, locale: "C", timezone: "UTC" },
      limits: { inputBytes: 10000, outputBytes: 10000, cells: 10, sheets: 1, operations: 1000 }
    }, true);
    expect(book.sheets[0]!.cells[0]!.value).toEqual({ kind: "number", value: kind === "attribute" ? 0 : kind === "nested" ? 3 : 2 });
  }
});

it.each([7, 8] as const)("exports a union SUM operand without a redundant PtgParen in BIFF%i", revision => {
  const book = { sheets: [{ id: "S", name: "S", cells: [] }] };
  const writer = new BiffFormulaWriter(book, revision, {
    own() {}, signal: new AbortController().signal,
    environment: { env: {}, locale: "C", timezone: "UTC" },
    limits: { inputBytes: 10000, outputBytes: 10000, cells: 100, sheets: 1, operations: 1000 }
  });
  const ref = (row: number) => [0x44, row, 0, 0, ...(revision === 8 ? [0] : [])];
  // Native matrix: either reference class and either SUM encoding work without
  // PtgParen. Adding PtgParen around the union instead returns #VALUE!.
  expect([...writer.compile("=SUM(($A$11,$A$12))", "S", 0, 0).tokens])
    .toEqual([...ref(10), ...ref(11), 0x10, 0x42, 1, 4, 0]);
  expect([...writer.compile("=SUM(($A$11,($A$12,$A$13)))", "S", 0, 0).tokens])
    .toEqual([...ref(10), ...ref(11), ...ref(12), 0x10, 0x10, 0x42, 1, 4, 0]);
  expect([...writer.compile("=SUM((($A$11,$A$12)))", "S", 0, 0).tokens])
    .toEqual([...ref(10), ...ref(11), 0x10, 0x15, 0x42, 1, 4, 0]);
  expect(writer.compile("=AREAS((($A$11,$A$12),$A$13))", "S", 0, 0).diagnostics)
    .toEqual([expect.objectContaining({ code: "biff-loss-warning", severity: "warning" })]);
});

it.each([2, 3, 4, 5, 7, 8])("preserves a right-nested BIFF%i union as one area", revision => {
  const ref = (row: number) => [0x24, row, 0, 0, ...(revision >= 8 ? [0] : [])];
  const formula = translateBiffFormula(new Uint8Array([
    ...ref(10), ...ref(11), ...ref(12), 0x10, 0x10, 0x21, 75, ...(revision >= 4 ? [0] : [])
  ]), { revision, codepage: 1252, row: 0, column: 0, names: [], externalSheets: [], limit: 10000 });
  expect(formula).toBe("=AREAS(($A$11,($A$12,$A$13)))");
});

it.each([2, 3, 4, 5, 7, 8])("retains original BIFF%i grouping around a SUM set", revision => {
  const ref = (row: number) => [0x24, row, 0, 0, ...(revision >= 8 ? [0] : [])];
  const formula = translateBiffFormula(new Uint8Array([
    ...ref(10), ...ref(11), 0x10, 0x15, 0x19, 0x10, 0, ...(revision >= 3 ? [0] : [])
  ]), { revision, codepage: 1252, row: 0, column: 0, names: [], externalSheets: [], limit: 10000 });
  expect(formula).toBe("=SUM((($A$11,$A$12)))");
});
