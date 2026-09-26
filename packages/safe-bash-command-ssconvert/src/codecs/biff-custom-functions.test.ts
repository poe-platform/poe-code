import { expect, it } from "vitest";
import type { CapabilityContext } from "../contracts.js";
import type { Workbook } from "../workbook.js";
import { recalculateWorkbook } from "../formulas/evaluator.js";
import { readBiff, createBiffWriter } from "./biff.js";
import { translateBiffFormula } from "./biff-formulas.js";

const context: CapabilityContext = { signal: new AbortController().signal, own() {},
  environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 100000, outputBytes: 100000, cells: 100, sheets: 4, operations: 1000 } };
const formulaContext = (revision: number) => ({ revision, codepage: 1252, row: 0, column: 0,
  names: ["_xlfn.IFERROR"], nameSheets: [undefined], externalSheets: [], limit: 1000 });
function string(revision: number, text: string): Uint8Array {
  return new Uint8Array([0x17, text.length, ...(revision === 8 ? [0] : []), ...new TextEncoder().encode(text)]);
}
function join(...parts: Uint8Array[]): Uint8Array {
  const bytes = new Uint8Array(parts.reduce((size, part) => size + part.length, 0));
  let offset = 0; for (const part of parts) { bytes.set(part, offset); offset += part.length; } return bytes;
}
function indexed(revision: number): Uint8Array {
  const bytes = new Uint8Array(revision === 8 ? 5 : 15); bytes[0] = 0x43; bytes[1] = 1; return bytes;
}
const args = new Uint8Array([0x1c, 7, 0x1e, 7, 0]);
const call = new Uint8Array([0x42, 3, 255, 0]);
it.each([7, 8])("reads string and indexed BIFF%i custom-function names in every token class", revision => {
  for (const raw of [0x22, 0x42, 0x62]) for (const name of [string(revision, "_xlfn.IFERROR"), indexed(revision)])
    expect(translateBiffFormula(join(name, args, new Uint8Array([raw, 3, 255, 0])), formulaContext(revision))).toBe("=IFERROR(#DIV/0!,7)");
});
it("normalizes known extension aliases and preserves unknown placeholder identity", () => {
  expect(translateBiffFormula(join(string(8, "_xlfnodf.GAMMA"), new Uint8Array([0x1e, 5, 0, 0x42, 2, 255, 0])), formulaContext(8))).toBe("=GAMMA(5)");
  expect(translateBiffFormula(join(string(8, "_xlfn.UNREGISTERED"), new Uint8Array([0x42, 1, 255, 0])), formulaContext(8))).toBe("=_xlfn.UNREGISTERED()");
});
it("bounds custom-function counts and keeps broken suppliers as native errors", () => {
  for (const tokens of [new Uint8Array([0x42, 0, 255, 0]), new Uint8Array([0x42, 2, 255, 0])])
    expect(() => translateBiffFormula(tokens, formulaContext(8))).toThrow("Invalid Excel BIFF");
  expect(translateBiffFormula(new Uint8Array([0x1e, 7, 0, 0x42, 1, 255, 0]), formulaContext(8))).toBe('=#"#Unknown!"');
  expect(translateBiffFormula(new Uint8Array([0x1e, 7, 0, 0x42, 1, 255, 0, 0x1e, 1, 0, 3]), formulaContext(8))).toBe('=#"#Unknown!"');
  expect(() => translateBiffFormula(join(string(8, "SUM(1)+SUM"), new Uint8Array([0x42, 1, 255, 0])), formulaContext(8))).toThrow("formula node limit");
  expect(() => translateBiffFormula(join(string(8, "_xlfn.IFERROR"), args, call), { ...formulaContext(8), limit: 10 })).toThrow("work limit");
});
function record(opcode: number, payload: Uint8Array = new Uint8Array()): Uint8Array {
  const bytes = new Uint8Array(payload.length + 4), view = new DataView(bytes.buffer);
  view.setUint16(0, opcode, true); view.setUint16(2, payload.length, true); bytes.set(payload, 4); return bytes;
}
it.each([7, 8] as const)("recalculates an original BIFF%i macro-name input and writer roundtrip", async revision => {
  const nameHeader = new Uint8Array(14); nameHeader[0] = 14; nameHeader[3] = 13;
  const name = record(0x18, join(nameHeader, new Uint8Array(revision === 8 ? [0] : []), new TextEncoder().encode("_xlfn.IFERROR")));
  const tokens = join(indexed(revision), args, call), formula = new Uint8Array(22 + tokens.length), view = new DataView(formula.buffer);
  view.setFloat64(6, 999, true); view.setUint16(20, tokens.length, true); formula.set(tokens, 22);
  const diagnostics: string[] = [];
  const imported = await readBiff(join(record(0x809, new Uint8Array([0, revision === 8 ? 6 : 5, 5, 0])), name, record(10),
    record(0x809, new Uint8Array([0, revision === 8 ? 6 : 5, 16, 0])), record(6, formula), record(10)),
  { ...context, async diagnostic(value) { diagnostics.push(value.message); } });
  expect(imported.sheets[0]!.cells[0]!.formula).toBe("=IFERROR(#DIV/0!,7)");
  expect(diagnostics).toEqual([]);
  expect(recalculateWorkbook(imported, context, true).sheets[0]!.cells[0]!.value).toEqual({ kind: "number", value: 7 });
  const importedRoundtrip = await readBiff(await createBiffWriter(revision)(imported, [], context), context);
  expect(recalculateWorkbook(importedRoundtrip, context, true).sheets[0]!.cells[0]!.value).toEqual({ kind: "number", value: 7 });
  const input: Workbook = { sheets: [{ id: "s", name: "Here", cells: [{ row: 0, column: 0, formula: "=IFERROR(1/0,7)", value: { kind: "number", value: 999 } }] }] };
  const reopened = await readBiff(await createBiffWriter(revision)(input, [], context), context);
  expect(recalculateWorkbook(reopened, context, true).sheets[0]!.cells[0]!.value).toEqual({ kind: "number", value: 7 });
});
