import { expect, it } from "vitest";
import type { CapabilityContext } from "../contracts.js";
import { recalculateWorkbook } from "../formulas/evaluator.js";
import { readBiff } from "./biff.js";
import { translateBiffFormula } from "./biff-formulas.js";

const context: CapabilityContext = { signal: new AbortController().signal, own() {},
  environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 100000, outputBytes: 100000, cells: 100, sheets: 4, operations: 1000 } };
function record(opcode: number, payload: readonly number[] | Uint8Array = []): Uint8Array {
  const bytes = new Uint8Array(payload.length + 4), view = new DataView(bytes.buffer);
  view.setUint16(0, opcode, true); view.setUint16(2, payload.length, true); bytes.set(payload, 4); return bytes;
}
function join(...parts: Uint8Array[]): Uint8Array {
  const bytes = new Uint8Array(parts.reduce((size, part) => size + part.length, 0));
  let offset = 0; for (const part of parts) { bytes.set(part, offset); offset += part.length; } return bytes;
}
function token(kind: number, index: number, first: number, last: number): Uint8Array {
  const bytes = new Uint8Array(kind === 0x3a ? 18 : 21), view = new DataView(bytes.buffer);
  bytes[0] = kind; view.setInt16(1, index, true); view.setInt16(11, first, true); view.setInt16(13, last, true);
  if (kind === 0x3b) { view.setUint16(17, 1, true); bytes[20] = 1; }
  return bytes;
}
const formulaContext = { revision: 7, codepage: 1252, row: 2, column: 0,
  names: [], externalSheets: ["First", "Middle", "Last"], limit: 100 };

it.each([
  [-2, 2, 2, "='Middle'!$A$1"], [-1, 1, 3, "='First':'Last'!$A$1"],
  [-3, 3, 1, "='Last':'First'!$A$1"], [1, 1, 3, "='First':'Last'!$A$1"],
  [-2, -1, 2, "=#REF!"], [-2, 2, -1, "=#REF!"]
] as const)("reads source-defined legacy link fields %i,%i,%i", (index, first, last, expected) => {
  expect(translateBiffFormula(token(0x3a, index, first, last), formulaContext)).toBe(expected);
});
it("reads legacy areas with separate row and column endpoints", () => {
  expect(translateBiffFormula(token(0x3b, -1, 1, 3), formulaContext)).toBe("='First':'Last'!$A$1:$B$2");
});
it.each([0x3a, 0x3b])("bounds the complete legacy token %i before link resolution", kind => {
  const bytes = token(kind, -1, 1, 1);
  expect(() => translateBiffFormula(bytes.subarray(0, bytes.length - 1), formulaContext)).toThrow("Invalid Excel BIFF");
});
it("retains unresolved legacy links rather than manufacturing a local binding", () => {
  expect(() => translateBiffFormula(token(0x3a, -4, 1, 1), formulaContext)).toThrow("external BIFF workbook reference");
});

it("resolves the zero endpoint against the current sheet and legacy self placeholders without a foreign binding", () => {
  expect(translateBiffFormula(token(0x3a, -1, 1, 0), { ...formulaContext, currentSheet: "Here" }))
    .toBe("='First':'Here'!$A$1");
  expect(translateBiffFormula(token(0x3a, -1, 1, 1), { ...formulaContext, externalSheets: [null] })).toBe("=$A$1");
  expect(translateBiffFormula(token(0x3a, -1, 1, 2), { ...formulaContext, externalSheets: ["First", null] }))
    .toBe("='First'!$A$1");
});

it("distinguishes ordinary absolute positions from shared relative offsets in legacy 3D tokens", () => {
  const bytes = token(0x3a, -1, 1, 1);
  new DataView(bytes.buffer).setUint16(15, 0xc001, true); bytes[17] = 1;
  expect(translateBiffFormula(bytes, formulaContext)).toBe("='First'!B2");
  expect(translateBiffFormula(bytes, { ...formulaContext, shared: true })).toBe("='First'!B4");
});

it("materializes shared legacy 3D tokens at each member's position using the worksheet table", async () => {
  const tokens = token(0x3a, -1, 1, 1); new DataView(tokens.buffer).setUint16(15, 0xbffe, true);
  const formula = (row: number) => {
    const bytes = new Uint8Array(27), view = new DataView(bytes.buffer);
    view.setUint16(0, row, true); view.setUint16(2, 1, true); view.setFloat64(6, 999, true);
    view.setUint16(20, 5, true); bytes.set([1, 2, 0, 1, 0], 22); return record(6, bytes);
  };
  const shared = new Uint8Array(10 + tokens.length), view = new DataView(shared.buffer);
  view.setUint16(0, 2, true); view.setUint16(2, 3, true); shared[4] = shared[5] = 1;
  shared[7] = 2; view.setUint16(8, tokens.length, true); shared.set(tokens, 10);
  const book = await readBiff(join(record(0x809, [0, 5, 16, 0]), record(0x17, [1, 2]),
    formula(2), record(0x4bc, shared), formula(3), record(10)), context);
  expect(book.sheets[0]!.cells.map(cell => cell.formula)).toEqual(["='Worksheet'!$A1", "='Worksheet'!$A2"]);
  expect(book.sheets[0]!.formulaGroups).toMatchObject([{ kind: "shared", expression: "='Worksheet'!$A1" }]);
});

it("binds each worksheet's original link table independently of globals and neighboring worksheets", async () => {
  const link = (name: string) => record(0x17, [name.length, 3, ...new TextEncoder().encode(name)]);
  const formula = () => {
    const tokens = token(0x3a, -1, 1, 1), bytes = new Uint8Array(22 + tokens.length), view = new DataView(bytes.buffer);
    view.setUint16(0, 2, true); view.setFloat64(6, 999, true); view.setUint16(20, tokens.length, true); bytes.set(tokens, 22);
    return record(6, bytes);
  };
  const number = (value: number) => {
    const bytes = new Uint8Array(14); new DataView(bytes.buffer).setFloat64(6, value, true); return record(0x203, bytes);
  };
  const book = await readBiff(join(record(0x809, [0, 5, 5, 0]), link("Worksheet3"), record(10),
    record(0x809, [0, 5, 16, 0]), link("Worksheet2"), number(10), formula(), record(10),
    record(0x809, [0, 5, 16, 0]), link("Worksheet"), number(20), formula(), record(10),
    record(0x809, [0, 5, 16, 0]), number(30), record(10)), context);
  expect(book.sheets[0]!.cells[1]!.formula).toBe("='Worksheet2'!$A$1");
  expect(book.sheets[1]!.cells[1]!.formula).toBe("='Worksheet'!$A$1");
  const recalculated = recalculateWorkbook(book, context, true);
  expect(recalculated.sheets[0]!.cells[1]!.value).toEqual({ kind: "number", value: 20 });
  expect(recalculated.sheets[1]!.cells[1]!.value).toEqual({ kind: "number", value: 10 });
});
