import { expect, it } from "vitest";
import type { CapabilityContext } from "../contracts.js";
import { parseExpression } from "../formulas/parser.js";
import { rewriteReferences } from "../formulas/rewriting.js";
import { recalculateWorkbook } from "../formulas/evaluator.js";
import { readBiff, createBiffWriter } from "./biff.js";
import { writeGnumeric } from "./gnumeric.js";
import { createXlsxWriter } from "./xlsx.js";
import { translateBiffFormula } from "./biff-formulas.js";
import { BiffFormulaWriter } from "./biff-write-formulas.js";
import type { Workbook } from "../workbook.js";
import { readBiffRecords, readCfb } from "./biff-binary.js";

const context: CapabilityContext = { signal: new AbortController().signal, own() {},
  environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 100000, outputBytes: 100000, cells: 100, sheets: 2, operations: 1000 } };
const record = (opcode: number, data: readonly number[]) => [opcode & 255, opcode >> 8, data.length & 255, data.length >> 8, ...data];

// Calc excform8.cxx, compiler.cxx and interpr4.cxx: automatic labels retain
// their identity, and range-valued uses stop at the first contiguous data area.
for (const axis of ["row", "column"] as const) {
  for (const aggregate of [false, true]) for (const valueClass of [false, true]) {
    it(`recalculates an automatic ${axis} label as ${aggregate ? "a range" : "a scalar"} (valueClass=${valueClass})`, async () => {
      const bytes = record(0x809, [0, 6, 5, 0]);
      bytes.push(...record(0x160, [1, 0]));
      bytes.push(...record(10, []), ...record(0x809, [0, 6, 16, 0]));
      bytes.push(...record(0x204, [0, 0, 0, 0, 0, 0, 5, 0, 0, ...Array.from("Sales", c => c.charCodeAt(0))]));
      for (const [offset, number] of [[1, 2], [2, 3], [4, 100]]) {
        const data = new Uint8Array(14), view = new DataView(data.buffer);
        view.setUint16(axis === "row" ? 2 : 0, offset!, true);
        view.setFloat64(6, number!, true);
        bytes.push(...record(0x203, [...data]));
      }
      const tokens = [0x18, (axis === "row" ? 2 : 3) + (valueClass ? 4 : 0), 0, 0, 0, 0, ...(aggregate ? [0x22, 1, 4, 0] : [])];
      const data = new Uint8Array(22), view = new DataView(data.buffer);
      view.setUint16(0, axis === "row" ? 2 : 1, true);
      view.setUint16(2, axis === "row" ? 1 : 2, true);
      view.setFloat64(6, 999, true); view.setUint16(20, tokens.length, true);
      bytes.push(...record(6, [...data, ...tokens]), ...record(10, []));
      const messages: string[] = [];
      const book = await readBiff(Uint8Array.from(bytes), { ...context, async diagnostic(d) { messages.push(d.message); } });
      const calculated = recalculateWorkbook(book, context, true);
      expect(calculated.sheets[0]!.cells.at(-1)!.value).toEqual({ kind: "number", value: aggregate ? 5 : 2 });
      const output = await createBiffWriter(8)(calculated, [], context);
      const formula = readBiffRecords(readCfb(output, context).get("Workbook")!, context).find(record => record.opcode === 6)!;
      expect([...formula.data.bytes.subarray(22, 28)]).toEqual(tokens.slice(0, 6));
      expect(recalculateWorkbook(await readBiff(output, context), context, true).sheets[0]!.cells.find(cell => cell.formula)!.value)
        .toEqual({ kind: "number", value: aggregate ? 5 : 2 });
      expect(messages).toEqual([]);
    });
  }
}

const book: Workbook = { sheets: [{ id: "S", name: "S", cells: [
  { row: 2, column: 1, formula: "=@row:$A1", value: { kind: "number", value: 2 } }
] }] };

it("rejects native output that cannot carry live-label identity", async () => {
  for (const write of [writeGnumeric, createXlsxWriter("2006"), createXlsxWriter("2008"), createBiffWriter(7)])
    await expect(write(book, [], context)).rejects.toMatchObject({ code: "unsupported-feature" });
});

it("allows quoted tag text in Gnumeric and XLSX formulas", async () => {
  const text = { sheets: [{ id: "S", name: "S", cells: [{ row: 0, column: 0, formula: '="@row:$A1"', value: { kind: "string" as const, value: "@row:$A1" } }] }] };
  for (const write of [writeGnumeric, createXlsxWriter("2008")]) expect((await write(text, [], context)).length).toBeGreaterThan(0);
});

it("does not silently bind unsupported BIFF label anchors", () => {
  const writer = new BiffFormulaWriter(book, 8, context);
  for (const source of ["=@row:$A1", "=@row:A$1", "=@column:$A1", "=@row:S!$A$1", "=@row:$A$65537"])
    expect(() => writer.compile(source, "S", 2, 1)).toThrow("live label reference");
  expect(() => writer.compile("=@row:$A1", "S", 2, 1, { name: "Sales", expression: "=@row:$A1", position: { sheet: "S", row: 2, column: 1 } }))
    .toThrow("live label reference");
});

it("rejects truncated ELF payloads and preserves valid column flags", () => {
  const formulaContext = { revision: 8 as const, row: 2, column: 1, names: [], externalSheets: [], codepage: 1252, limit: 1000 };
  const bytes = Uint8Array.from([0x18, 6, 0, 1, 255, 192]);
  expect(translateBiffFormula(bytes, formulaContext)).toBe("=@row.value.quoted:IV257");
  for (let end = 1; end < bytes.length; end++) expect(() => translateBiffFormula(bytes.subarray(0, end), formulaContext)).toThrow();
});

// MS-XLS ColElfU: bits 0..13 are the column (<=255), bit 14 is
// fQuoted, and bit 15 is fRelative for the corresponding row and column.
for (const subtype of [2, 3, 6, 7]) for (const relative of [false, true]) for (const quoted of [false, true]) {
  it(`preserves ELF subtype ${subtype}, relative=${relative}, quoted=${quoted} through edits and export`, () => {
    const position = { sheet: "S", row: 260, column: 9 };
    const flags = Number(relative) * 128 + Number(quoted) * 64;
    const tokens = Uint8Array.from([24, subtype, 1, 1, 5, flags]);
    const source = translateBiffFormula(tokens, { revision: 8, ...position, names: [], externalSheets: [], codepage: 1252, limit: 1000 });
    const axis = subtype === 2 || subtype === 6 ? "row" : "column";
    const tag = "@" + axis + (subtype >= 6 ? ".value" : "") + (quoted ? ".quoted" : "") + ":";
    expect(source).toBe("=" + tag + (relative ? "F258" : "$F$258"));
    const parsed = parseExpression(source, { position });
    if (!parsed.ok) throw new Error(parsed.diagnostic.message);
    const target = { sheet: "S", row: 265, column: 11 };
    const copied = rewriteReferences(parsed.document, { position: target, translation: "copy" });
    expect(copied).toBe("=" + tag + (relative ? "H263" : "$F$258"));
    const writer = new BiffFormulaWriter(book, 8, context);
    expect(writer.compile(source, "S", position.row, position.column).tokens).toEqual(tokens);
    expect([...writer.compile(copied, "S", target.row, target.column).tokens]).toEqual([24, subtype, relative ? 6 : 1, 1, relative ? 7 : 5, flags]);
    const moved = rewriteReferences(parsed.document, { position: target, translation: "move" });
    expect(writer.compile(moved, "S", target.row, target.column).tokens).toEqual(tokens);
  });
}

it("rejects ColElfU columns above 255 instead of truncating their address", () => {
  for (const high of [1, 63, 65, 129, 255]) expect(() => translateBiffFormula(Uint8Array.from([24, 2, 0, 0, 0, high]),
    { revision: 8, row: 0, column: 0, names: [], externalSheets: [], codepage: 1252, limit: 1000 }))
    .toThrow("label column");
});
