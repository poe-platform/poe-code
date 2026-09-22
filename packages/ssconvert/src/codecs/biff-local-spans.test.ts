import { expect, it } from "vitest";
import type { CapabilityContext } from "../contracts.js";
import { readBiff, createBiffWriter } from "./biff.js";
import { translateBiffFormula } from "./biff-formulas.js";
import { recalculateWorkbook } from "../formulas/evaluator.js";

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
// Original record/token fixture, independent of the production BIFF writer.
function workbook(first: number, last: number, token: number, sum = false): Uint8Array {
  const tokens = token === 0x3a ? [token, 0, 0, 0, 0, 0, 0] : [token, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0];
  if (sum) tokens.push(0x22, 1, 4, 0);
  const formula = new Uint8Array(22 + tokens.length), view = new DataView(formula.buffer);
  view.setUint16(0, 2, true);
  view.setFloat64(6, 999, true); view.setUint16(20, tokens.length, true); formula.set(tokens, 22);
  const number = (value: number) => {
    const bytes = new Uint8Array(14); new DataView(bytes.buffer).setFloat64(6, value, true); return record(0x203, bytes);
  };
  return join(record(0x809, [0, 6, 5, 0]), record(0x1ae, [2, 0, 1, 4]),
    record(0x17, [1, 0, 0, 0, first, 0, last, 0]), record(10),
    record(0x809, [0, 6, 16, 0]), record(6, formula), number(1), record(10),
    record(0x809, [0, 6, 16, 0]), number(2), record(10));
}

it.each([
  [0, 1, 0x3a, "='Worksheet':'Worksheet2'!$A$1"],
  [1, 0, 0x3a, "='Worksheet2':'Worksheet'!$A$1"],
  [0, 1, 0x3b, "='Worksheet':'Worksheet2'!$A$1:$B$2"],
  [1, 0, 0x3b, "='Worksheet2':'Worksheet'!$A$1:$B$2"],
  [0, 0, 0x3a, "='Worksheet'!$A$1"]
] as const)("imports local BIFF8 endpoints %i:%i for token %x", async (first, last, token, formula) => {
  const diagnostics: string[] = [];
  const book = await readBiff(workbook(first, last, token), { ...context,
    async diagnostic(value) { diagnostics.push(value.message); } });
  expect(book.sheets[0]!.cells[0]).toMatchObject({ formula, cachedResult: { kind: "number", value: 999 } });
  expect(diagnostics).toEqual([]);
  const reopened = await readBiff(await createBiffWriter(8)(book, [], context), context);
  // The writer canonically emits a one-cell sheet span as an Area3D token.
  const canonical = first !== last && token === 0x3a ? formula + ":$A$1" : formula;
  expect(reopened.sheets[0]!.cells.find(cell => cell.row === 2)!.formula).toBe(canonical);
});

it.each([[0, 1, 0x3a], [1, 0, 0x3a], [0, 1, 0x3b], [1, 0, 0x3b]])(
  "recalculates imported span %i:%i token %i instead of reusing its stale cache", async (first, last, token) => {
    const book = await readBiff(workbook(first, last, token, true), context);
    expect(recalculateWorkbook(book, context, true).sheets[0]!.cells[0]!.value).toEqual({ kind: "number", value: 3 });
  });

it("quotes both endpoints independently and charges their complete expression", () => {
  const formulaContext = { revision: 8, codepage: 1252, row: 0, column: 0, names: [],
    externalSheets: [["O'Brien", "Last sheet"] as const], limit: 100 };
  const bytes = new Uint8Array([0x3a, 0, 0, 0, 0, 0, 0]);
  expect(translateBiffFormula(bytes, formulaContext)).toBe("='O''Brien':'Last sheet'!$A$1");
  expect(() => translateBiffFormula(bytes, { ...formulaContext, limit: 20 })).toThrow("work limit");
  expect(() => translateBiffFormula(bytes.subarray(0, 6), formulaContext)).toThrow("Invalid Excel BIFF");
});

it.each([[0, 2], [2, 0]])("retains invalid local endpoint %i:%i instead of manufacturing a sheet", async (first, last) => {
  const diagnostics: string[] = [];
  const book = await readBiff(workbook(first, last, 0x3a), { ...context,
    async diagnostic(value) { diagnostics.push(value.message); } });
  expect(book.sheets[0]!.cells[0]!.formula).toBeUndefined();
  expect(diagnostics).toContain("Unsupported ssconvert feature: external BIFF workbook reference");
});

it("continues refusing unbound external books without fetching or substituting the cache", () => {
  expect(() => translateBiffFormula(new Uint8Array([0x3a, 0, 0, 0, 0, 0, 0]), {
    revision: 8, codepage: 1252, row: 0, column: 0, names: [], externalSheets: [undefined], limit: 100
  })).toThrow("external BIFF workbook reference");
});
