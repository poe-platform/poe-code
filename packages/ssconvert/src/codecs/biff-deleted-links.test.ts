import { expect, it } from "vitest";
import type { CapabilityContext } from "../contracts.js";
import { recalculateWorkbook } from "../formulas/evaluator.js";
import { createBiffWriter, readBiff } from "./biff.js";
import { translateBiffFormula } from "./biff-formulas.js";

const context: CapabilityContext = { signal: new AbortController().signal, own() {},
  environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 10000, outputBytes: 10000, cells: 100, sheets: 2, operations: 1000 } };
function join(...parts: Uint8Array[]): Uint8Array {
  const result = new Uint8Array(parts.reduce((size, part) => size + part.length, 0));
  let offset = 0; for (const part of parts) { result.set(part, offset); offset += part.length; } return result;
}
function record(opcode: number, bytes: Uint8Array = new Uint8Array()): Uint8Array {
  const result = new Uint8Array(bytes.length + 4), view = new DataView(result.buffer);
  view.setUint16(0, opcode, true); view.setUint16(2, bytes.length, true); result.set(bytes, 4); return result;
}
function tokens(raw: number): Uint8Array {
  const result = new Uint8Array((raw & 0x1f) === 0x1a ? 7 : 11); result[0] = raw; return result;
}
function workbook(raw: number, first: number, last: number, local = true): Uint8Array {
  const link = new Uint8Array(8), v = new DataView(link.buffer); v.setUint16(0, 1, true); v.setUint16(4, first, true); v.setUint16(6, last, true);
  const formula = join(tokens(raw), new Uint8Array([0x1e, 1, 0, 3]));
  const cell = new Uint8Array(22 + formula.length), view = new DataView(cell.buffer);
  view.setFloat64(6, 99, true); view.setUint16(20, formula.length, true); cell.set(formula, 22);
  return join(record(0x809, new Uint8Array([0, 6, 5, 0])), record(0x1ae, new Uint8Array(local ? [1, 0, 1, 4] : [1, 0, 0, 0])), record(0x17, link), record(10),
    record(0x809, new Uint8Array([0, 6, 16, 0])), record(6, cell), record(10));
}
it.each([[0xffff, 0], [0, 0xffff], [0xffff, 0xffff]])("imports deleted BIFF8 link endpoints %i,%i in every reference token class", async (first, last) => {
  for (const raw of [0x3a, 0x5a, 0x7a, 0x3b, 0x5b, 0x7b]) {
    const diagnostics: string[] = [];
    const book = await readBiff(workbook(raw, first, last), { ...context, async diagnostic(value) { diagnostics.push(value.message); } });
    expect(book.sheets[0]!.cells[0]!.formula).toBe("=#REF!+1");
    expect(diagnostics).toEqual([]);
    expect(recalculateWorkbook(book, context, true).sheets[0]!.cells[0]!.value).toEqual({ kind: "error", value: "#REF!" });
    const reopened = await readBiff(await createBiffWriter(8)(book, [], context), context);
    expect(recalculateWorkbook(reopened, context, true).sheets[0]!.cells[0]!.value).toEqual({ kind: "error", value: "#REF!" });
  }
});
it("keeps true external books and invalid local indexes explicitly unsupported", async () => {
  for (const [first, last, local] of [[0, 0, false], [0xffff, 0xffff, false], [1, 1, true]] as const) {
    const diagnostics: string[] = [];
    const book = await readBiff(workbook(0x3a, first, last, local), { ...context, async diagnostic(value) { diagnostics.push(value.message); } });
    expect(book.sheets[0]!.cells[0]!.formula).toBeUndefined();
    expect(diagnostics.some(message => message.includes("external BIFF workbook reference"))).toBe(true);
  }
});
it("bounds the complete modern reference payload before consuming deleted links", () => {
  const base = { revision: 8, codepage: 1252, row: 0, column: 0, names: [], externalSheets: [undefined], deletedExternalSheets: [true], limit: 100 };
  for (const raw of [0x3a, 0x5a, 0x7a, 0x3b, 0x5b, 0x7b]) {
    const bytes = tokens(raw);
    expect(translateBiffFormula(bytes, base)).toBe("=#REF!");
    expect(() => translateBiffFormula(bytes.subarray(0, bytes.length - 1), base)).toThrow("Invalid Excel BIFF");
    expect(() => translateBiffFormula(bytes, { ...base, limit: 4 })).toThrow("work limit");
  }
});
