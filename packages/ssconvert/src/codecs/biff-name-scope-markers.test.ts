import { expect, it } from "vitest";
import type { CapabilityContext } from "../contracts.js";
import { recalculateWorkbook } from "../formulas/evaluator.js";
import { createBiffWriter, readBiff } from "./biff.js";
import { translateBiffFormula } from "./biff-formulas.js";

const context: CapabilityContext = { signal: new AbortController().signal, own() {},
  environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 100000, outputBytes: 100000, cells: 100, sheets: 4, operations: 1000 } };
function record(opcode: number, bytes: Uint8Array = new Uint8Array()): Uint8Array {
  const result = new Uint8Array(bytes.length + 4), view = new DataView(result.buffer);
  view.setUint16(0, opcode, true); view.setUint16(2, bytes.length, true); result.set(bytes, 4); return result;
}
function join(...parts: Uint8Array[]): Uint8Array {
  const result = new Uint8Array(parts.reduce((size, part) => size + part.length, 0));
  let offset = 0; for (const part of parts) { result.set(part, offset); offset += part.length; } return result;
}
function name(scope: number, value: number): Uint8Array {
  const header = new Uint8Array(14), view = new DataView(header.buffer);
  header[3] = 4; view.setUint16(4, 3, true); view.setUint16(8, scope, true);
  return record(0x18, join(header, new Uint8Array([0, 82, 97, 116, 101, 0x1e, value, 0])));
}
function token(raw: number, index: number): Uint8Array { return new Uint8Array([raw, 0, 0, index, 0, 0, 0]); }
function workbook(first: number, last: number, raw: number, global: boolean, local = true): Uint8Array {
  const link = new Uint8Array(8), v = new DataView(link.buffer);
  v.setUint16(0, 1, true); v.setUint16(4, first, true); v.setUint16(6, last, true);
  const tokens = token(raw, global ? 1 : 2), cell = new Uint8Array(22 + tokens.length), view = new DataView(cell.buffer);
  view.setFloat64(6, 999, true); view.setUint16(20, tokens.length, true); cell.set(tokens, 22);
  return join(record(0x809, new Uint8Array([0, 6, 5, 0])),
    name(global ? 0 : 1, global ? 99 : 20), name(global ? 1 : 2, global ? 20 : 30),
    record(0x1ae, new Uint8Array(local ? [2, 0, 1, 4] : [2, 0, 0, 0])), record(0x17, link), record(10),
    record(0x809, new Uint8Array([0, 6, 16, 0])), record(6, cell), record(10),
    record(0x809, new Uint8Array([0, 6, 16, 0])), record(10));
}
it.each([[0xffff, 0xffff], [0xfffe, 0xfffe], [0, 0xffff]].flatMap(([first, last]) => [false, true].map(global => ({ first: first!, last: last!, global }))))(
  "preserves indexed NameX identity with first$first,last$last,global$global", async ({ first, last, global }) => {
    for (const raw of [0x39, 0x59, 0x79]) {
      const diagnostics: string[] = [];
      const book = await readBiff(workbook(first, last, raw, global), { ...context, async diagnostic(value) { diagnostics.push(value.message); } });
      expect(book.sheets[0]!.cells[0]!.formula).toBe(global ? "=[]Rate" : "='Worksheet2'!Rate");
      expect(diagnostics).toEqual([]);
      const expected = { kind: "number", value: global ? 99 : 30 };
      expect(recalculateWorkbook(book, context, true).sheets[0]!.cells[0]!.value).toEqual(expected);
      const reopened = await readBiff(await createBiffWriter(8)(book, [], context), context);
      expect(recalculateWorkbook(reopened, context, true).sheets[0]!.cells[0]!.value).toEqual(expected);
    }
  });
it("never grants local-name authority to true external books or invalid first-sheet indexes", async () => {
  for (const [first, last, local] of [[0xffff, 0xffff, false], [0xfffe, 0xfffe, false], [2, 2, true]] as const) {
    const diagnostics: string[] = [];
    const book = await readBiff(workbook(first, last, 0x39, true, local), { ...context, async diagnostic(value) { diagnostics.push(value.message); } });
    expect(book.sheets[0]!.cells[0]!.formula).toBeUndefined();
    expect(diagnostics.some(message => message.includes("external BIFF workbook reference"))).toBe(true);
  }
});
it("keeps modern name-only self markers out of ordinary 3D cell references", async () => {
  const diagnostics: string[] = [];
  const bytes = workbook(0xfffe, 0xfffe, 0x3a, true);
  const book = await readBiff(bytes, { ...context, async diagnostic(value) { diagnostics.push(value.message); } });
  expect(book.sheets[0]!.cells[0]!.formula).toBeUndefined();
  expect(diagnostics.some(message => message.includes("external BIFF workbook reference"))).toBe(true);
});
it("bounds NameX payload/index/work with an independently supplied name display scope", () => {
  const base = { revision: 8, codepage: 1252, row: 0, column: 0, names: ["Rate", "Rate"], nameSheets: [undefined, "Other"],
    externalSheets: [undefined], externalNameSheets: [null], limit: 100 };
  for (const raw of [0x39, 0x59, 0x79]) {
    expect(translateBiffFormula(token(raw, 1), base)).toBe("=[]Rate");
    expect(translateBiffFormula(token(raw, 2), base)).toBe("='Other'!Rate");
    expect(translateBiffFormula(token(raw, 0), base)).toBe("=#REF!");
    expect(translateBiffFormula(token(raw, 3), base)).toBe("=#REF!");
    expect(() => translateBiffFormula(token(raw, 1).subarray(0, 6), base)).toThrow("Invalid Excel BIFF");
    expect(() => translateBiffFormula(token(raw, 1), { ...base, limit: 4 })).toThrow("work limit");
  }
});
