import { expect, it } from "vitest";
import type { CapabilityContext } from "../contracts.js";
import { recalculateWorkbook } from "../formulas/evaluator.js";
import { parseExpression } from "../formulas/parser.js";
import { renameWorkbookSheet, remapWorkbookSheets } from "../formulas/workbook.js";
import { dirtyWorkbook } from "../workbook/updates/recalculation.js";
import { resizeWorkbookReferences } from "../workbook/resize.js";
import { rewriteReferences } from "../formulas/rewriting.js";
import { serializeExpression } from "../formulas/serialization.js";
import { readBiff, createBiffWriter } from "./biff.js";
import { readBiffRecords, readCfb } from "./biff-binary.js";
import { translateBiffFormula } from "./biff-formulas.js";

const context: CapabilityContext = { signal: new AbortController().signal, own() {},
  environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 100000, outputBytes: 100000, cells: 100, sheets: 2, operations: 1000 } };
const record = (opcode: number, data: readonly number[]) => [opcode & 255, opcode >> 8, data.length & 255, data.length >> 8, ...data];
const words = (...values: number[]) => values.flatMap(value => [value & 255, value >> 8]);
const formulaContext = { revision: 8 as const, row: 2, column: 1, names: [], externalSheets: [], codepage: 1252, limit: 1000 };

// MS-XLS PtgElfRadical includes a following PtgArea/PtgAreaErr, not padding.
// A gap inside that explicit area and adjacent data outside it distinguish the
// stored range from Calc's inferred contiguous region.
for (const axis of ["row", "column"] as const) for (const after of [false, true]) {
  for (const aggregate of [false, true]) for (const areaClass of [0x20, 0x40, 0x60]) {
    it(`preserves ${axis} radical data (${after ? "after" : "before"}, SUM=${aggregate}, class=${areaClass})`, async () => {
      const labelRow = axis === "row" ? 0 : after ? 4 : 0, labelColumn = axis === "column" ? 0 : after ? 4 : 0;
      const bytes = record(0x809, [0, 6, 5, 0]);
      bytes.push(...record(10, []), ...record(0x809, [0, 6, 16, 0]));
      bytes.push(...record(0x204, [...words(labelRow, labelColumn, 0, 5), 0, ...Array.from("Sales", c => c.charCodeAt(0))]));
      for (const [offset, value] of [[1, 2], [3, 3], [after ? 0 : 4, 100]]) {
        const data = new Uint8Array(14), view = new DataView(data.buffer);
        view.setUint16(axis === "row" ? 2 : 0, offset!, true); view.setFloat64(6, value!, true);
        bytes.push(...record(0x203, [...data]));
      }
      const area = axis === "row" ? words(0, 0, 1, 3) : words(1, 3, 0, 0);
      const tokens = [24, 10, ...words(labelRow, labelColumn), areaClass | 5, ...area, ...(aggregate ? [0x22, 1, 4, 0] : [])];
      const data = new Uint8Array(22), view = new DataView(data.buffer);
      view.setUint16(0, axis === "row" ? 2 : 1, true); view.setUint16(2, axis === "row" ? 1 : 2, true);
      view.setFloat64(6, 999, true); view.setUint16(20, tokens.length, true);
      bytes.push(...record(6, [...data, ...tokens]), ...record(10, []));
      const warnings: string[] = [];
      const book = await readBiff(Uint8Array.from(bytes), { ...context, async diagnostic(d) { warnings.push(d.message); } });
      const calculated = recalculateWorkbook(book, context, true);
      expect(calculated.sheets[0]!.cells.find(cell => cell.formula)?.value).toEqual({ kind: "number", value: aggregate ? 5 : 2 });
      const output = await createBiffWriter(8)(calculated, [], context);
      const formula = readBiffRecords(readCfb(output, context).get("Workbook")!, context).find(record => record.opcode === 6)!;
      expect([...formula.data.bytes.subarray(22, 37)]).toEqual(tokens.slice(0, 15));
      expect(recalculateWorkbook(await readBiff(output, context), context, true).sheets[0]!.cells.find(cell => cell.formula)?.value)
        .toEqual({ kind: "number", value: aggregate ? 5 : 2 });
      expect(warnings).toEqual([]);
    });
  }
}

it("copies and moves the radical anchor and area with their separate axis flags", () => {
  const position = { sheet: "S", row: 2, column: 1 };
  const source = "=SUM(@range.array.quoted:A1->$B1:D$1)";
  const parsed = parseExpression(source, { position });
  if (!parsed.ok) throw new Error(parsed.diagnostic.message);
  expect(serializeExpression(parsed.document, undefined, false)).toBe(source);
  expect(rewriteReferences(parsed.document, { position: { sheet: "S", row: 3, column: 2 }, translation: "copy" }))
    .toBe("=SUM(@range.array.quoted:B2->$B2:E$1)");
  expect(rewriteReferences(parsed.document, { position: { sheet: "S", row: 3, column: 2 }, translation: "move" })).toBe(source);
  expect(rewriteReferences(parsed.document, { endpoint: ref => ({ ...ref, column: { value: 5, relative: false } }) }))
    .toBe("=SUM(@range.array.quoted:$F1->$F1:$F$1)");
});

it("retains a radical anchor when its explicit area is deleted", async () => {
  const tokens = Uint8Array.from([24, 10, 0, 0, 0, 0x40, 0x4b, ...Array<number>(8).fill(255)]);
  const source = translateBiffFormula(tokens, formulaContext);
  expect(source).toBe("=@range.value.quoted:$A$1->#REF!");
  const book = { sheets: [{ id: "S", name: "S", cells: [{ row: 2, column: 1, formula: source, value: { kind: "number" as const, value: 999 } }] }] };
  const calculated = recalculateWorkbook(book, context, true);
  expect(calculated.sheets[0]!.cells[0]!.value).toEqual({ kind: "error", value: "#REF!" });
  const output = await createBiffWriter(8)(calculated, [], context);
  const formula = readBiffRecords(readCfb(output, context).get("Workbook")!, context).find(record => record.opcode === 6)!;
  expect([...formula.data.bytes.subarray(22, 29)]).toEqual([...tokens.subarray(0, 7)]);
  expect((await readBiff(output, context)).sheets[0]!.cells[0]!.formula).toBe(source);
});

it("renames differently spelled qualifiers in the anchor and explicit area", () => {
  const book = { sheets: [{ id: "S", name: "Sales", cells: [{ row: 2, column: 1, formula: "=SUM(@range:Sales!$A$1->sales!$B$1:$D$1)", value: { kind: "blank" as const } }] }] };
  for (const output of [renameWorkbookSheet(book, "S", "New Sales", context),
    remapWorkbookSheets(book, new Map([["S", { id: "new", name: "New Sales" }]]), context)]) {
    const formula = output.sheets[0]!.cells[0]!.formula!;
    expect(formula).not.toContain("sales!");
    const parsed = parseExpression(formula, { position: { sheet: output.sheets[0]!.id, row: 2, column: 1 } });
    if (!parsed.ok) throw new Error(parsed.diagnostic.message);
    const root = parsed.document.root;
    expect(root.kind === "call" && root.args[0]).toMatchObject({ first: { sheet: "New Sales" }, label: { data: { first: { sheet: "New Sales" } } } });
  }
});

it("clips and deletes the explicit area during a sheet resize without replacing the label", () => {
  const book = { sheets: [{ id: "S", name: "S", size: { rows: 256, columns: 512 }, cells: [
    { row: 2, column: 1, formula: "=SUM(@range:$A$1->$B$1:$KP$1)", value: { kind: "blank" as const } },
    { row: 3, column: 1, formula: "=SUM(@range:$A$1->$IW$1:$KP$1)", value: { kind: "blank" as const } }
  ] }] };
  const output = resizeWorkbookReferences(book, "S", { rows: 256, columns: 256 }, context);
  expect(output.sheets[0]!.cells.map(cell => cell.formula)).toEqual(["=SUM(@range:$A$1->$B$1:$IV$1)", "=SUM(@range:$A$1->#REF!)"]);
});

it("rejects malformed or geometrically invalid radical records", () => {
  const prefix = [24, 10, 0, 0, 0, 0];
  const valid = [...prefix, 0x25, ...words(0, 0, 1, 3)];
  for (let end = 1; end < valid.length; end++) expect(() => translateBiffFormula(Uint8Array.from(valid.slice(0, end)), formulaContext)).toThrow();
  for (const tail of [[0x24, ...words(0, 0, 1, 3)], [0x25, ...words(0, 0, 2, 3)], [0x25, ...words(0, 1, 1, 3)],
    [0x25, ...words(0, 0, 3, 1)], [0x25, ...words(0, 0, 1, 256)]])
    expect(() => translateBiffFormula(Uint8Array.from([...prefix, ...tail]), formulaContext)).toThrow("radical label");
});

it("returns REF for a missed explicit scalar intersection but keeps single-cell data position independent", () => {
  const book = (formula: string) => ({ sheets: [{ id: "S", name: "S", cells: [
    { row: 0, column: 0, value: { kind: "string" as const, value: "Sales" } },
    { row: 0, column: 1, value: { kind: "number" as const, value: 2 } },
    { row: 2, column: 5, formula, value: { kind: "blank" as const } }
  ] }] });
  const value = (formula: string) => recalculateWorkbook(book(formula), context, true).sheets[0]!.cells.find(cell => cell.formula)!.value;
  expect(value("=@range:$A$1->$B$1:$D$1")).toEqual({ kind: "error", value: "#REF!" });
  expect(value("=@range:$A$1->$B$1:$B$1")).toEqual({ kind: "number", value: 2 });
});

it("tracks the explicit area without dirtying it for unrelated data edits", () => {
  const book = recalculateWorkbook({ sheets: [{ id: "S", name: "S", cells: [
    { row: 0, column: 0, value: { kind: "string", value: "Sales" } },
    { row: 0, column: 1, value: { kind: "number", value: 2 } },
    { row: 0, column: 3, value: { kind: "number", value: 3 } },
    { row: 0, column: 4, value: { kind: "number", value: 100 } },
    { row: 2, column: 5, formula: "=SUM(@range:$A$1->$B$1:$D$1)", value: { kind: "blank" } }
  ] }] }, context, true);
  const changed = (column: number) => dirtyWorkbook(book, [{ sheet: "S", startRow: 0, endRow: 0, startColumn: column, endColumn: column }], context);
  expect(changed(4).sheets[0]!.cells.find(cell => cell.formula)!.formulaDirty).toBe(false);
  expect(changed(1).sheets[0]!.cells.find(cell => cell.formula)!.formulaDirty).toBe(true);
  const edited = { ...book, sheets: book.sheets.map(sheet => ({ ...sheet, cells: sheet.cells.map(cell => cell.column === 1 ?
    { ...cell, value: { kind: "number" as const, value: 7 } } : cell) })) };
  const dirty = dirtyWorkbook(edited, [{ sheet: "S", startRow: 0, endRow: 0, startColumn: 1, endColumn: 1 }], context);
  expect(recalculateWorkbook(dirty, context, { force: false, queueVolatile: false }).sheets[0]!.cells.find(cell => cell.formula)!.value)
    .toEqual({ kind: "number", value: 10 });
});
