import { expect, it } from "vitest";
import { createDatabaseFunctions, createEngine, type DatabaseQueryResult } from "../index.js";
import { renderCellText } from "../formatting.js";
import type { CapabilityContext } from "../contracts.js";
import type { Workbook } from "../workbook.js";
import { recalculateWorkbook } from "./evaluator.js";
import { readGnumeric } from "../codecs/gnumeric.js";

const context: CapabilityContext = {
  signal: new AbortController().signal, own() {}, environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 10000, outputBytes: 10000, cells: 100, sheets: 4, operations: 100, workbookWork: 10000 }
};

// GDA attaches a value format to its date/time scalars. Native Gnumeric
// retains that format through references, IF and INDEX, but not arithmetic.
it("preserves database date/time formats through array selection and references", async () => {
  const formula = '=READDBTABLE("owned","","","dates")';
  const book: Workbook = { sheets: [{ id: "s", name: "S", formulaGroups: [{ id: "g", kind: "array", expression: formula,
    range: { startRow: 0, endRow: 1, startColumn: 0, endColumn: 0 } }], cells: [
    { row: 0, column: 0, value: { kind: "blank" }, formula, formulaGroup: "g", formulaDirty: true },
    ...["=A1", "=A2", "=IF(TRUE,A1,0)", "=INDEX(A1:A2,2)", "=A1+0", "=SUM(A2)"].map((formula, row) =>
      ({ row, column: 1, value: { kind: "blank" as const }, formula, formulaDirty: true }))
  ] }] };
  const rows = [[{ kind: "number" as const, value: 45292, format: "m/d/yy" }],
    [{ kind: "number" as const, value: .5, format: "h:mm:ss AM/PM" }]];
  const result = recalculateWorkbook(book, { ...context, runtimeFunctions: createDatabaseFunctions(() => ({ kind: "recordset", rows })) });
  const cells = result.sheets[0]!.cells.filter(cell => cell.column === 1);
  expect(await Promise.all(cells.map(cell => renderCellText(cell, result, context))))
    .toEqual(["2024/01/01", "12:00:00", "2024/01/01", "12:00:00", "45292", "0.5"]);
  expect(await renderCellText({ ...cells[0]!, format: "0.00" }, result, context, "preserve")).toBe("45292.00");
  expect(await renderCellText(cells[0]!, result, context, "raw")).toBe("45292");
  expect(rows[0]![0]!.format).toBe("m/d/yy");
});

it("rejects malformed database value formats before using returned data", () => {
  const book: Workbook = { sheets: [{ id: "s", name: "S", cells: [
    { row: 0, column: 0, formula: '=EXECSQL("owned","","","SELECT d")', formulaDirty: true, value: { kind: "blank" } }
  ] }] };
  const rows = [[{ kind: "number" as const, value: 45292, format: 7 }]];
  expect(() => recalculateWorkbook(book, { ...context, runtimeFunctions: createDatabaseFunctions(() => ({ kind: "recordset", rows }) as unknown as DatabaseQueryResult) }))
    .toThrow("Invalid number value format");
});

it("retains imported value formats through formula references after an XML checkpoint", async () => {
  const source = '<gnm:Workbook xmlns:gnm="http://www.gnumeric.org/v10.dtd"><gnm:SheetNameIndex><gnm:SheetName>S</gnm:SheetName></gnm:SheetNameIndex>' +
    '<gnm:Sheets><gnm:Sheet><gnm:Name>S</gnm:Name><gnm:Cells>' +
    '<gnm:Cell Row="0" Col="0" ValueType="40" ValueFormat="m/d/yy">45292</gnm:Cell>' +
    '<gnm:Cell Row="1" Col="0" ValueType="40" ValueFormat="h:mm:ss AM/PM">0.5</gnm:Cell>' +
    '<gnm:Cell Row="0" Col="1">=A1</gnm:Cell><gnm:Cell Row="1" Col="1">=A2</gnm:Cell>' +
    '</gnm:Cells></gnm:Sheet></gnm:Sheets></gnm:Workbook>';
  const result = recalculateWorkbook(await readGnumeric(new TextEncoder().encode(source), context), context);
  expect(await Promise.all(result.sheets[0]!.cells.filter(cell => cell.column === 1).map(cell => renderCellText(cell, result, context))))
    .toEqual(["2024/01/01", "12:00:00"]);
});

it.each(["Gnumeric_XmlIO:sax:0", "Gnumeric_Excel:xlsx", "Gnumeric_Excel:xlsx2", "Gnumeric_Excel:excel_biff7", "Gnumeric_Excel:excel_biff8", "Gnumeric_Excel:excel_dsf"])(
  "preserves value-owned date formats when exporting %s", async exportType => {
    const limits = { ...context.limits, inputBytes: 1000000, outputBytes: 1000000, workbookWork: 1000000 };
    const book: Workbook = { sheets: [{ id: "s", name: "S", cells: [
      { row: 0, column: 0, format: "General", value: { kind: "number", value: 45292, format: "m/d/yy" } },
      { row: 1, column: 0, value: { kind: "number", value: .5, format: "h:mm:ss AM/PM" } },
      { row: 2, column: 0, format: "0.00", value: { kind: "number", value: 45292, format: "m/d/yy" } }
    ] }] };
    const engine = createEngine({ codecs: [{ id: "fixture", description: "fixture", extensions: [], async read() { return book; } }], limits, environment: context.environment });
    const output: Uint8Array[] = [];
    try {
      const owned = await engine.readWorkbook({ kind: "stream", source: [] }, { importType: "fixture" }, context);
      expect((await engine.writeWorkbook(owned, { kind: "stream", sink: { async write(bytes) { output.push(bytes); } } }, { exportType }, context)).exitCode).toBe(0);
      const round = await engine.readWorkbook({ kind: "stream", source: output }, {}, context);
      expect(await Promise.all(round.sheets[0]!.cells.map(cell => renderCellText(cell, round, context))))
        .toEqual(["2024/01/01", "12:00:00", "45292"]);
      expect(await renderCellText(round.sheets[0]!.cells[2]!, round, context, "preserve")).toBe("45292.00");
    } finally { await engine.dispose(); }
  });

it("owns and bounds database format metadata without executing accessors", () => {
  const book: Workbook = { sheets: [{ id: "s", name: "S", cells: [
    { row: 0, column: 0, formula: '=EXECSQL("owned","","","SELECT d")', formulaDirty: true, value: { kind: "blank" } }
  ] }] };
  let reads = 0;
  const accessor = { kind: "number" as const, value: 45292, get format() { reads++; return "m/d/yy"; } };
  const supplied = { kind: "number" as const, value: 45292, format: "m/d/yy" };
  const calculate = (value: typeof supplied) => recalculateWorkbook(book, { ...context, runtimeFunctions:
    createDatabaseFunctions(() => ({ kind: "recordset", rows: [[value]] })) });
  expect(() => calculate(accessor)).toThrow("accessor");
  expect(reads).toBe(0);
  expect(() => calculate({ ...supplied, format: "0".repeat(100000) })).toThrow("text limit");
  const owned = calculate(supplied).sheets[0]!.cells[0]!.value;
  supplied.format = "0.00";
  expect(owned).toEqual({ kind: "number", value: 45292, format: "m/d/yy" });
  expect(Object.isFrozen(owned)).toBe(true);
});

it("uses the workbook date convention and explicit style ahead of the value format", async () => {
  const book: Workbook = { dateSystem: "1904", sheets: [] };
  const cell = { row: 0, column: 0, format: "General", value: { kind: "number" as const, value: 0, format: "m/d/yy" } };
  expect(await renderCellText(cell, book, context)).toBe("1904/01/01");
  expect(await renderCellText({ ...cell, format: "0.00" }, book, context, "preserve")).toBe("0.00");
});
