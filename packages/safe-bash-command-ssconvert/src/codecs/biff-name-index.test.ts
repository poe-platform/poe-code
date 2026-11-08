import { readBiff } from "./biff.js";
import { recalculateWorkbook } from "../formulas/evaluator.js";
import { expect, it } from "vitest";
import { translateBiffFormula } from "./biff-formulas.js";
import { BiffFormulaWriter } from "./biff-write-formulas.js";
import type { CapabilityContext } from "../contracts.js";

const context: CapabilityContext = { signal: new AbortController().signal, own() {},
  environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 100000, outputBytes: 100000, cells: 100, sheets: 4, operations: 1000 } };
const formulaContext = { revision: 8, codepage: 1252, row: 0, column: 0, names: ["Low"], externalSheets: ["Here"], limit: 1000 };
function token(raw: number, index: number): Uint8Array {
  const bytes = new Uint8Array((raw & 0x1f) === 0x19 ? 7 : 5);
  bytes[0] = raw; new DataView(bytes.buffer).setUint32(bytes.length - 4, index, true); return bytes;
}
// MS-XLS PtgNameX: nameindex is four bytes, independent of ixti.
it.each([0x39, 0x59, 0x79])("does not alias a missing large external name index to its low word, token %i", raw => {
  expect(translateBiffFormula(token(raw, 65537), { ...formulaContext,
    externalNames: [[{ name: "Low", expression: "=41" }]] })).toBe("=#REF!");
});
it.each([0x39, 0x59, 0x79])("preserves an admitted external name index above 65535, token %i", raw => {
  const entries: { name: string; expression: string }[] = [];
  entries[0] = { name: "Low", expression: "=41" };
  entries[65536] = { name: "High", expression: "=42" };
  expect(translateBiffFormula(token(raw, 65537), { ...formulaContext, externalNames: [entries] })).toBe("=(42)");
});
it.each([0x23, 0x43, 0x63, 0x39, 0x59, 0x79])("uses all four name-index bytes for indexed local identity, token %i", raw => {
  const names: string[] = []; names[0] = "Low"; names[65536] = "High";
  expect(translateBiffFormula(token(raw, 65537), { ...formulaContext, names })).toBe((raw & 0x1f) === 0x19 ? "='Here'!High" : "=High");
});
it.each([false, true])("writes the full modern name index after relocation, qualified=%s", qualified => {
  const names = Array.from({ length: 65537 }, (_, index) => ({ name: `Name_${index}`, expression: "=1" }));
  const book = { sheets: [{ id: "Here", name: "Here", cells: [] }], names };
  const writer = new BiffFormulaWriter(book, 8, context);
  const formula = writer.compile(qualified ? "=Here!Name_65536" : "=Name_65536", "Here", 0, 0);
  writer.finalize();
  const bytes = formula.tokens;
  expect(new DataView(bytes.buffer, bytes.byteOffset).getUint32(qualified ? 3 : 1, true)).toBe(65537);
});
it("writes the full modern add-in index independently of local name relocations", () => {
  const writer = new BiffFormulaWriter({ sheets: [{ id: "Here", name: "Here", cells: [] }] }, 8, context);
  for (let index = 0; index < 65536; index++) writer.externNames.push(`ADDIN_${index}`);
  const formula = writer.compile("=ADDIN_65536()", "Here", 0, 0);
  writer.finalize();
  expect(new DataView(formula.tokens.buffer, formula.tokens.byteOffset).getUint32(3, true)).toBe(65537);
});
it.each([false, true])("refuses unrepresentable legacy name indexes without truncation, qualified=%s", qualified => {
  const names = Array.from({ length: 65537 }, (_, index) => ({ name: `Name_${index}`, expression: "=1" }));
  const writer = new BiffFormulaWriter({ sheets: [{ id: "Here", name: "Here", cells: [] }], names }, 7, context);
  expect(() => {
    writer.compile(qualified ? "=Here!Name_65536" : "=Name_65536", "Here", 0, 0);
    writer.finalize();
  }).toThrow("index exceeds version limits");
});
it("refuses unrepresentable legacy add-in indexes", () => {
  const writer = new BiffFormulaWriter({ sheets: [{ id: "Here", name: "Here", cells: [] }] }, 7, context);
  for (let index = 0; index < 65536; index++) writer.externNames.push(`ADDIN_${index}`);
  expect(() => writer.compile("=ADDIN_65536()", "Here", 0, 0)).toThrow("index exceeds version limits");
});

it("keeps a missing high NameX index unbound through original workbook import and recalculation", async () => {
  function record(opcode: number, payload: Uint8Array): Uint8Array {
    const bytes = new Uint8Array(4 + payload.length), view = new DataView(bytes.buffer);
    view.setUint16(0, opcode, true); view.setUint16(2, payload.length, true); bytes.set(payload, 4); return bytes;
  }
  const declaration = new Uint8Array(21);
  declaration[3] = 3; declaration[4] = 3;
  declaration.set([0, 76, 111, 119, 0x1e, 42, 0], 14);
  const nameToken = token(0x59, 65537), formula = new Uint8Array(22 + nameToken.length), view = new DataView(formula.buffer);
  view.setFloat64(6, 999, true); view.setUint16(20, nameToken.length, true); formula.set(nameToken, 22);
  const parts = [record(0x809, new Uint8Array([0, 6, 5, 0])), record(0x18, declaration),
    record(0x1ae, new Uint8Array([1, 0, 1, 4])), record(0x17, new Uint8Array([1, 0, 0, 0, 0, 0, 0, 0])),
    record(10, new Uint8Array()), record(0x809, new Uint8Array([0, 6, 16, 0])), record(6, formula), record(10, new Uint8Array())];
  const bytes = new Uint8Array(parts.reduce((length, part) => length + part.length, 0));
  let offset = 0; for (const part of parts) { bytes.set(part, offset); offset += part.length; }
  const book = await readBiff(bytes, context);
  expect(book.sheets[0]!.cells[0]).toMatchObject({ formula: "=#REF!", cachedResult: { kind: "number", value: 999 } });
  expect(recalculateWorkbook(book, context, true).sheets[0]!.cells[0]!.value).toEqual({ kind: "error", value: "#REF!" });
});
