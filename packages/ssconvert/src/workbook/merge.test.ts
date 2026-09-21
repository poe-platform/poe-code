import { describe, expect, it } from "vitest";
import { mergeWorkbookSheets } from "./merge.js";
import type { Workbook } from "../workbook.js";
import { recalculateWorkbook } from "../formulas/evaluator.js";

const limits = { inputBytes: 10000, outputBytes: 10000, cells: 100, sheets: 20, operations: 100 };
const sheet = (name: string) => ({ id: name, name, cells: [] });
const range = { sheet: "Data", startRow: 0, endRow: 0, startColumn: 0, endColumn: 0 };

describe("Gnumeric merge ownership and collisions", () => {
  it("applies the native default floor when suggesting dimensions for small sheets", () => {
    const merged = mergeWorkbookSheets({ sheets: [{ ...sheet("Small"), size: { rows: 128, columns: 128 } }] },
      { sheets: [{ ...sheet("Wide"), size: { rows: 256, columns: 512 } }] }, limits);
    expect(merged.sheets.map(s => s.size)).toEqual(Array(2).fill({ rows: 65536, columns: 512 }));
  });

  it("bounds collision scanning even when the incoming sheets have no formulas", () => {
    const sheets = Array.from({ length: 10 }, (_, index) => sheet(index ? `Data(${index + 1})` : "Data"));
    expect(() => mergeWorkbookSheets({ sheets }, { sheets: [sheet("Data")] }, { ...limits, workbookWork: 5 }))
      .toThrow("ssconvert workbook work limit exceeded");
  });

  it("migrates case-distinct workbook names without treating them as conflicts", () => {
    const target: Workbook = { sheets: [sheet("One")], names: [{ name: "Clash", expression: "=10" }] };
    const incoming: Workbook = { sheets: [sheet("Two")], names: [{ name: "clash", expression: "=20" }] };
    expect(mergeWorkbookSheets(target, incoming, limits).names).toEqual([...target.names!, ...incoming.names!]);
  });

  it("revives exact-case named dependencies and evaluates distinct merged names", () => {
    const book: Workbook = { sheets: [{ ...sheet("One"), cells: [
      { row: 0, column: 0, formula: "=Clash", value: { kind: "blank" } },
      { row: 0, column: 1, formula: "=clash", value: { kind: "blank" } }
    ] }], names: [{ name: "Clash", expression: "=10" }, { name: "clash", expression: "=20" }] };
    const calculated = recalculateWorkbook(book, { limits, signal: new AbortController().signal,
      environment: { env: {}, locale: "C", timezone: "UTC" }, own() {} }, true);
    expect(calculated.sheets[0]?.cells.map(cell => cell.value)).toEqual([{ kind: "number", value: 10 }, { kind: "number", value: 20 }]);
  });
  it("moves sheet metadata and objects while discarding incoming workbook settings", () => {
    const incoming: Workbook = { sheets: [{ ...sheet("Data"), view: { zoom: 2 }, unsupportedRecords: [
      { source: "Gnumeric_XmlIO:sax", kind: "Objects", disposition: "retained", data: { name: "Objects", children: [] } }
    ] }], properties: { title: "source" }, dateSystem: "1904", calculationMode: "manual",
      iteration: { enabled: true, maximum: 10, tolerance: 0.01 }, view: { zoom: 3 } };
    const merged = mergeWorkbookSheets({ sheets: [] }, incoming, limits);
    expect(merged.sheets[0]?.view).toEqual({ zoom: 2 });
    expect(merged.sheets[0]?.unsupportedRecords).toEqual(incoming.sheets[0]?.unsupportedRecords);
    expect(merged.properties).toBeUndefined();
    expect(merged.dateSystem).toBeUndefined();
    expect(merged.calculationMode).toBeUndefined();
  });

  it("rehomes formulas, local names and dynamic dependencies together", () => {
    const incoming: Workbook = { sheets: [{ ...sheet("Data"), cells: [{ row: 0, column: 1,
      value: { kind: "blank" }, formula: "=Data!A1" }] }],
      names: [{ name: "Local", sheet: "Data", expression: "=Data!A1", position: { sheet: "Data", row: 0, column: 0 } }],
      dependencies: [{ dependent: range, precedent: range, dynamic: true }] };
    const merged = mergeWorkbookSheets({ sheets: [sheet("Data")] }, incoming, limits);
    expect(merged.sheets.map(s => s.name)).toEqual(["Data", "Data(2)"]);
    expect(merged.sheets[1]?.cells[0]?.formula).toBe("='Data(2)'!A1");
    expect(merged.names?.[0]).toMatchObject({ sheet: "Data(1)", expression: "='Data(2)'!A1", position: { sheet: "Data(1)" } });
    expect(merged.dependencies?.[0]).toMatchObject({ dynamic: true, dependent: { sheet: "Data(1)" }, precedent: { sheet: "Data(1)" } });
    expect(incoming.sheets[0]?.name).toBe("Data");
  });

  it("reports the first sorted workbook name conflict without renaming names", () => {
    const names = [{ name: "Zulu", expression: "=1" }, { name: "Alpha", expression: "=2" }];
    expect(() => mergeWorkbookSheets({ sheets: [sheet("One")], names }, { sheets: [sheet("Two")], names }, limits))
      .toThrow("Name conflict during merge: 'Alpha' appears twice at workbook scope.");
  });

  it("orders supplementary name conflicts by native UTF-8 collation", () => {
    const names = [{ name: "𐐀", expression: "=1" }, { name: "Ａ", expression: "=2" }];
    expect(() => mergeWorkbookSheets({ sheets: [sheet("One")], names }, { sheets: [sheet("Two")], names }, limits))
      .toThrow("Name conflict during merge: 'Ａ' appears twice at workbook scope.");
  });

  it("uses compatibility normalization for conflict ordering without normalizing name identity", () => {
    const names = [{ name: "Zulu", expression: "=1" }, { name: "Ａ", expression: "=2" }];
    expect(() => mergeWorkbookSheets({ sheets: [sheet("One")], names }, { sheets: [sheet("Two")], names }, limits))
      .toThrow("Name conflict during merge: 'Ａ' appears twice at workbook scope.");
    const merged = mergeWorkbookSheets({ sheets: [sheet("One")], names: [{ name: "A", expression: "=1" }] },
      { sheets: [sheet("Two")], names: [{ name: "Ａ", expression: "=2" }] }, limits);
    expect(merged.names?.map(name => name.name)).toEqual(["A", "Ａ"]);
  });

  it("strips an empty parenthesized suffix as native counter zero", () => {
    const merged = mergeWorkbookSheets({ sheets: [sheet("Data()")] }, { sheets: [sheet("Data()")] }, limits);
    expect(merged.sheets[1]?.name).toBe("Data(1)");
  });

  it("uses the largest supported dimensions for every sheet", () => {
    const merged = mergeWorkbookSheets({ sheets: [{ ...sheet("One"), size: { rows: 16777216, columns: 128 } }] },
      { sheets: [{ ...sheet("Two"), size: { rows: 128, columns: 16384 } }] }, limits);
    expect(merged.sheets.map(s => s.size)).toEqual(Array(2).fill({ rows: 16777216, columns: 16384 }));
  });

  it("rehomes retained chart dataset expressions while preserving object order", () => {
    const graph = { name: "SheetObjectGraph", namespace: "http://www.gnumeric.org/v10.dtd", text: "", attributes: [], children: [
      { name: "GogObject", namespace: "", text: "", attributes: [], children: [
        { name: "data", namespace: "", text: "", attributes: [], children: [
          { name: "dimension", namespace: "", text: "Data!$A$1:$A$2", attributes: [{ name: "type", namespace: "", value: "GnmGODataVector" }], children: [] }
        ] }
      ] }
    ] };
    const incoming: Workbook = { sheets: [{ ...sheet("Data"), unsupportedRecords: [
      { source: "Gnumeric_XmlIO:sax", kind: "Objects", disposition: "retained", data: {
        name: "Objects", namespace: "http://www.gnumeric.org/v10.dtd", text: "", attributes: [], children: [graph]
      } }
    ] }] };
    const merged = mergeWorkbookSheets({ sheets: [sheet("Data")] }, incoming, limits);
    expect(JSON.stringify(merged.sheets[1]?.unsupportedRecords)).toContain("'Data(2)'!$A$1:$A$2");
    expect(JSON.stringify(incoming)).toContain("Data!$A$1:$A$2");
  });
});
