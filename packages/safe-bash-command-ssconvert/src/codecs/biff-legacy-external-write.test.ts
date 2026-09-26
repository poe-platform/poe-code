import { expect, it } from "vitest";
import type { CapabilityContext } from "../contracts.js";
import type { Workbook } from "../workbook.js";
import { writeBiffStream } from "./biff-write.js";
import { readBiff } from "./biff.js";
import { readBiffRecords } from "./biff-binary.js";
import { recalculateWorkbook } from "../formulas/evaluator.js";
import { BiffFormulaWriter } from "./biff-write-formulas.js";
const context: CapabilityContext = { signal: new AbortController().signal, own() {},
  environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 100000, outputBytes: 100000, cells: 100, sheets: 4, operations: 1000 } };
const book = (formula: string): Workbook => ({ sheets: [{ id: "Here", name: "Here", cells: [
  { row: 0, column: 0, value: { kind: "number", value: 42 }, formula }
] }] });
it("writes sheet blocks before document names and uses positive 1-based legacy indexes", async () => {
  const input = book("=['first.xls']Other!Rate+['second.xls']Rate+['first.xls']Other!A1");
  const records = readBiffRecords(await writeBiffStream(input, 7, false, context), context);
  const start = records.findIndex(r => r.opcode === 0x809 && r.data.u16(2) === 16);
  const local = records.slice(start), links = local.filter(r => r.opcode === 0x17);
  expect(local.find(r => r.opcode === 0x16)!.data.u16(0)).toBe(6); // local, add-in, self, external sheet and two documents
  expect(links).toHaveLength(6);
  const names = local.filter(r => r.opcode === 0x23);
  expect(names.map(r => r.data.u16(2))).toEqual([4, 0]);
  const formula = local.find(r => r.opcode === 6)!.data;
  expect(formula.u8(22)).toBe(0x59); expect(formula.u16(23)).toBe(5); expect(formula.u16(33)).toBe(1);
  expect(formula.u8(47)).toBe(0x59); expect(formula.u16(48)).toBe(6); expect(formula.u16(58)).toBe(1);
  expect(formula.u8(73)).toBe(0x5a); expect(formula.u16(74)).toBe(4);
  expect(Array.from(formula.slice(76, 12))).toEqual(new Array(12).fill(0));
});
it.each(["book.xls", "dir/book.xls", "C:\\dir\\book.xls", "https://example.test/book.xls", "Café€.xls", "a".repeat(126), "a".repeat(140)])(
  "preserves legacy external path %s including raw lengths above 127", async path => {
    const qualifier = "['" + path.split("\\").join("\\\\") + "']";
    const imported = await readBiff(await writeBiffStream(book("=" + qualifier + "Other!$A$1"), 7, false, context), context);
    const requests: unknown[] = [];
    const result = recalculateWorkbook(imported, { ...context, externalReferences: { resolve(request) { requests.push(request); return { kind: "number", value: 84 }; } } }, true);
    expect(requests).toMatchObject([{ first: { workbook: path, sheet: "Other" } }]);
    expect(result.sheets[0]!.cells[0]!.value).toEqual({ kind: "number", value: 84 });
  });
it.each(["=['表.xls']Other!A1", "=['book.xls']'表'!A1", "=['book.xls']表", "=['a[b].xls']Other!A1", "=['" + "a".repeat(253) + "']Other!A1"])(
  "refuses a legacy identity that cannot be represented: %s", async formula => {
    await expect(writeBiffStream(book(formula), 7, false, context)).rejects.toThrow("external");
  });
it("refuses a BIFF7 external multi-sheet range instead of turning it into a single-sheet range", async () => {
  await expect(writeBiffStream(book("=SUM(['book.xls']First:Last!A1:B2)"), 7, false, context)).rejects.toThrow("external");
});
it("checks the signed external-link index limit after all declarations have been discovered", () => {
  const writer = new BiffFormulaWriter(book("=1"), 7, context);
  writer.compile("=['first.xls']Other!A1", "Here", 0, 0);
  writer.externalBooks[0]!.sheets.length = 32766;
  writer.compile("=['second.xls']Other!A1", "Here", 0, 0);
  expect(() => writer.finalize()).toThrow("index");
});
it("preserves external references in definitions and array formulas across worksheet tables", async () => {
  const input = book("=Alias");
  const source: Workbook = { ...input, names: [{ name: "Alias", expression: "=['book.xls']Other!$A$1" }], sheets: [
    input.sheets[0]!, { id: "Next", name: "Next", cells: [{ row: 0, column: 0, value: { kind: "number", value: 42 }, formula: "=['book.xls']Rate", formulaGroup: "a" }],
      formulaGroups: [{ id: "a", kind: "array", expression: "=['book.xls']Rate", range: { startRow: 0, endRow: 0, startColumn: 0, endColumn: 0 } }] }
  ] };
  const imported = await readBiff(await writeBiffStream(source, 7, false, context), context);
  expect(imported.sheets[1]!.formulaGroups?.[0]?.kind).toBe("array");
  let calls = 0;
  const result = recalculateWorkbook(imported, { ...context, externalReferences: { resolve() { calls++; return { kind: "number", value: 84 }; } } }, true);
  expect(calls).toBe(2); expect(result.sheets.map(s => s.cells[0]!.value)).toEqual([{ kind: "number", value: 84 }, { kind: "number", value: 84 }]);
});
it("keeps the sheet suffix outside a length-prefixed raw directory", async () => {
  const directory = "a".repeat(130) + "/";
  const bytes = await writeBiffStream(book("=['" + directory + "book.xls']Other!A1"), 7, false, context);
  const links = readBiffRecords(bytes, context).filter(r => r.opcode === 0x17 && r.data.bytes.length > 4 && r.data.u8(1) === 1);
  const path = links[0]!.data;
  expect(path.u8(2)).toBe(5); expect(path.u8(3)).toBe(directory.length);
  expect(new TextDecoder().decode(path.slice(4 + directory.length, path.bytes.length - 4 - directory.length))).toBe("[book.xls]Other");
});
it("preserves a global external name whose raw workbook path length is above 127", async () => {
  const path = "a".repeat(140) + ".xls";
  const imported = await readBiff(await writeBiffStream(book("=['" + path + "']Rate"), 7, false, context), context);
  const requests: unknown[] = [];
  recalculateWorkbook(imported, { ...context, externalReferences: { resolve(request) { requests.push(request); return undefined; } } }, true);
  expect(requests).toMatchObject([{ workbook: path, name: "Rate" }]);
});
