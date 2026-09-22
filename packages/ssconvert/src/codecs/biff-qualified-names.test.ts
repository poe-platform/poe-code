import { expect, it } from "vitest";
import type { CapabilityContext } from "../contracts.js";
import { recalculateWorkbook } from "../formulas/evaluator.js";
import { readBiff, createBiffWriter } from "./biff.js";
import { translateBiffFormula } from "./biff-formulas.js";

const context: CapabilityContext = { signal: new AbortController().signal, own() {},
  environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 100000, outputBytes: 100000, cells: 100, sheets: 4, operations: 1000 } };
function token(revision: number, raw = 0x39, index = 1): Uint8Array {
  const bytes = new Uint8Array(revision === 8 ? 7 : 25), view = new DataView(bytes.buffer);
  bytes[0] = raw; view.setInt16(1, revision === 8 ? 0 : -1, true); view.setUint16(revision === 8 ? 3 : 11, index, true);
  return bytes;
}
function formulaContext(revision: number) {
  return { revision, codepage: 1252, row: 0, column: 0, names: ["Rate"],
    nameSheets: ["Other"], externalSheets: ["Other"], limit: 100 };
}
it.each([7, 8])("reads local BIFF%i NameX in every token class", revision => {
  for (const raw of [0x39, 0x59, 0x79])
    expect(translateBiffFormula(token(revision, raw), formulaContext(revision))).toBe("='Other'!Rate");
});
it.each([7, 8])("returns native's #REF! for an unknown BIFF%i NameX index", revision => {
  expect(translateBiffFormula(token(revision, 0x39, 0), formulaContext(revision))).toBe("=#REF!");
  expect(translateBiffFormula(token(revision, 0x39, 2), formulaContext(revision))).toBe("=#REF!");
});
it.each([7, 8])("admits the full BIFF%i NameX payload before resolving indices", revision => {
  const bytes = token(revision);
  expect(() => translateBiffFormula(bytes.subarray(0, bytes.length - 1), formulaContext(revision))).toThrow("Invalid Excel BIFF");
});
it("uses a legacy self placeholder's indexed name scope and independently quotes it", () => {
  expect(translateBiffFormula(token(7), { ...formulaContext(7), externalSheets: [null],
    nameSheets: ["O'Brien"], currentSheet: "Here" })).toBe("='O''Brien'!Rate");
});
it("refuses an unbound external namespace and charges complete qualified-name text", () => {
  expect(() => translateBiffFormula(token(8), { ...formulaContext(8), externalSheets: [undefined] })).toThrow("external BIFF workbook reference");
  expect(() => translateBiffFormula(token(8, 0x39, 0), { ...formulaContext(8), externalSheets: [undefined] })).toThrow("external BIFF workbook reference");
  expect(() => translateBiffFormula(token(8), { ...formulaContext(8), limit: 5 })).toThrow("work limit");
});
it.each([7, 8])("preserves indexed global and neighboring local BIFF%i name identity", revision => {
  const bound = { ...formulaContext(revision), names: ["Rate", "Rate"], nameSheets: [undefined, "Other"] };
  for (const raw of [0x39, 0x59, 0x79])
    expect(translateBiffFormula(token(revision, raw), bound)).toBe("=[]Rate");
  for (const raw of [0x23, 0x43, 0x63]) {
    const bytes = new Uint8Array(revision === 8 ? 5 : 15);
    bytes[0] = raw; bytes[1] = 1;
    expect(translateBiffFormula(bytes, bound)).toBe("=[]Rate");
    bytes[1] = 2;
    expect(translateBiffFormula(bytes, bound)).toBe("='Other'!Rate");
  }
});
it("charges indexed name-shadow inspection against formula work", () => {
  expect(() => translateBiffFormula(token(8), { ...formulaContext(8),
    names: ["Rate", ...Array.from({ length: 100 }, (_, at) => "N" + at), "Rate"],
    nameSheets: [undefined, ...Array.from({ length: 100 }, () => undefined), "Other"], limit: 10 })).toThrow("work limit");
});
it("keeps the indexed local definition when NameX's display sheet differs", () => {
  expect(translateBiffFormula(token(8), { ...formulaContext(8), nameSheets: ["Here"] })).toBe("='Here'!Rate");
});

function record(opcode: number, payload: readonly number[] | Uint8Array = []): Uint8Array {
  const bytes = new Uint8Array(payload.length + 4), view = new DataView(bytes.buffer);
  view.setUint16(0, opcode, true); view.setUint16(2, payload.length, true); bytes.set(payload, 4); return bytes;
}
function join(...parts: Uint8Array[]): Uint8Array {
  const bytes = new Uint8Array(parts.reduce((size, part) => size + part.length, 0));
  let offset = 0; for (const part of parts) { bytes.set(part, offset); offset += part.length; } return bytes;
}
it.each([7, 8].flatMap(revision => ["local", "global-namex", "global-name"].map(mode => ({ revision, mode }))))("preserves indexed $mode ownership through original BIFF$revision import, recalculation and roundtrip", async ({ revision, mode }) => {
  const name = (scope: number, value: number) => {
    const header = new Uint8Array(14), view = new DataView(header.buffer);
    header[3] = 4; view.setUint16(4, 3, true); view.setUint16(revision === 8 ? 8 : 6, scope, true);
    return record(0x18, join(header, new Uint8Array(revision === 8 ? [0, 82, 97, 116, 101] : [82, 97, 116, 101]), new Uint8Array([0x1e, value, 0])));
  };
  const link = (text: string) => record(0x17, [text.length, 3, ...new TextEncoder().encode(text)]);
  const global = mode !== "local", expected = global ? 99 : 30;
  const tokens = mode === "global-name" ? new Uint8Array(revision === 8 ? [0x43, 1, 0, 0, 0] : [0x43, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]) : token(revision, 0x59, global ? 1 : 2);
  const formula = new Uint8Array(22 + tokens.length), view = new DataView(formula.buffer);
  view.setFloat64(6, 999, true); view.setUint16(20, tokens.length, true); formula.set(tokens, 22);
  const diagnostics: string[] = [];
  const book = await readBiff(join(record(0x809, [0, revision === 8 ? 6 : 5, 5, 0]),
    ...(revision === 8 ? [record(0x1ae, [2, 0, 1, 4]), record(0x17, [1, 0, 0, 0, 1, 0, 1, 0])] : [link("Worksheet"), link("Worksheet2")]),
    name(global ? 0 : 1, global ? 99 : 20), name(global ? 1 : 2, global ? 20 : 30), record(10), record(0x809, [0, revision === 8 ? 6 : 5, 16, 0]),
    ...(revision === 7 ? [link("Worksheet2")] : []), record(6, formula), record(10),
    record(0x809, [0, revision === 8 ? 6 : 5, 16, 0]), record(10)),
  { ...context, async diagnostic(value) { diagnostics.push(value.message); } });
  expect(book.names).toEqual(global ? [{ name: "Rate", expression: "=99" }, { name: "Rate", expression: "=20", sheet: "Worksheet" }] :
    [{ name: "Rate", expression: "=20", sheet: "Worksheet" }, { name: "Rate", expression: "=30", sheet: "Worksheet2" }]);
  expect(book.sheets[0]!.cells[0]!.formula).toBe(global ? "=[]Rate" : "='Worksheet2'!Rate");
  expect(diagnostics).toEqual([]);
  expect(recalculateWorkbook(book, context, true).sheets[0]!.cells[0]!.value).toEqual({ kind: "number", value: expected });
  const reopened = await readBiff(await createBiffWriter(revision as 7 | 8)(book, [], context), context);
  expect(reopened.sheets[0]!.cells[0]!.formula).toBe(global ? "=[]Rate" : "='Worksheet2'!Rate");
  expect(recalculateWorkbook(reopened, context, true).sheets[0]!.cells[0]!.value).toEqual({ kind: "number", value: expected });
});
