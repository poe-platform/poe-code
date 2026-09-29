import { expect, it } from "vitest";
import type { CapabilityContext } from "../contracts.js";
import type { Workbook } from "../workbook.js";
import { recalculateWorkbook } from "../formulas/evaluator.js";
import { createBiffWriter, readBiff } from "./biff.js";
import { translateBiffFormula } from "./biff-formulas.js";

const context: CapabilityContext = {
  signal: new AbortController().signal, own() {},
  environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 100000, outputBytes: 100000, cells: 100, sheets: 4, operations: 10000 }
};

it.each([
  ["leading BOM", "\uFEFFhello"],
  ["BOM at successive chunk boundaries", "a".repeat(255) + "\uFEFF" + "b".repeat(254) + "\uFEFFend"],
  ["unpaired surrogates", "\uD800left\uDC00right\uDBFF"],
  ["surrogate pair near chunk boundary", "a".repeat(254) + "\uD83D\uDE00end"],
  ["compressed Latin-1", "café"]
])("preserves BIFF8 formula string code units: %s", async (_label, text) => {
  const formula = '="' + text.split('"').join('""') + '"';
  const book: Workbook = { sheets: [{ id: "s", name: "Sheet", cells: [
    { row: 0, column: 0, formula, value: { kind: "string", value: text } }
  ] }] };
  const reopened = await readBiff(await createBiffWriter(8)(book, [], context), context);
  const cell = reopened.sheets[0]!.cells[0]!;
  expect(cell.value).toEqual({ kind: "string", value: text });
  const expectedFormula = text.length <= 255 ? formula : _label.startsWith("BOM") ?
    '=("' + "a".repeat(255) + '"&"\uFEFF' + "b".repeat(254) + '"&"\uFEFFend")' :
    '=("' + "a".repeat(254) + '"&"\uD83D\uDE00end")';
  expect(cell.formula).toBe(expectedFormula);
  expect(recalculateWorkbook(reopened, context, true).sheets[0]!.cells[0]!.value)
    .toEqual({ kind: "string", value: text });
});

it("rejects a truncated UTF-16 BIFF8 formula string", () => {
  expect(() => translateBiffFormula(Uint8Array.from([0x17, 2, 1, 0xff, 0xfe, 0x61]), {
    revision: 8, row: 0, column: 0, codepage: 1252, names: [], externalSheets: [], limit: 100
  })).toThrow();
});

it("preserves a surrogate pair split between imported PtgStr tokens", () => {
  expect(translateBiffFormula(Uint8Array.from([0x17, 1, 1, 0x3d, 0xd8, 0x17, 1, 1, 0, 0xde, 8]), {
    revision: 8, row: 0, column: 0, codepage: 1252, names: [], externalSheets: [], limit: 100
  })).toBe('="\uD83D"&"\uDE00"');
});
