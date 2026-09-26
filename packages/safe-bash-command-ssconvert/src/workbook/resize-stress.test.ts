import { expect, it } from "vitest";
import type { CapabilityContext } from "../contracts.js";
import type { ImportedValue, Workbook } from "../workbook.js";
import { resizeWorkbookReferences } from "./resize.js";

const ns = "http://www.gnumeric.org/v10.dtd";
const context = (): CapabilityContext => ({ limits: { sheets: 8, cells: 100, inputBytes: 100000, outputBytes: 100000, operations: 100 },
  signal: new AbortController().signal, environment: { env: {}, locale: "C", timezone: "UTC" }, own() {} });
const node = (name: string, attributes: Record<string, string>, children: ImportedValue[] = []): ImportedValue => ({ name, namespace: ns, text: "",
  attributes: Object.entries(attributes).map(([name, value]) => ({ name, namespace: "", value })), children });
const region = (bounds: Record<string, string>, format: string) => node("StyleRegion", bounds, [node("Style", { Format: format })]);

it("shrinks references on other sheets and names while preserving the expanded axis", () => {
  const input: Workbook = { activeSheet: "s", names: [{ name: "print_area", expression: "=Small!$A$1:$IV$256" }], sheets: [
    { id: "s", name: "Small", size: { rows: 256, columns: 256 }, cells: [] },
    { id: "o", name: "Other", cells: [
      { row: 2, column: 3, value: { kind: "blank" }, formula: "=Small!$IV$200" },
      { row: 3, column: 3, value: { kind: "blank" }, formula: "=Small!$IV$100" },
      { row: 4, column: 3, value: { kind: "blank" }, formula: "=SUM(Small!$IV$200:$IV$220)" },
      { row: 5, column: 3, value: { kind: "blank" }, formula: "=Small:SMALL!$IV$200" }
    ] }
  ] };
  const result = resizeWorkbookReferences(input, "s", { rows: 128, columns: 512 }, context());
  expect(result.names![0]!.expression).toBe("='Small'!$A$1:$IV$128");
  expect(result.sheets[1]!.cells.map(c => c.formula)).toEqual(["=#REF!", "=Small!$IV$100", "=SUM(#REF!)", "=#REF!"]);
  expect(input.names![0]!.expression).toBe("=Small!$A$1:$IV$256");
});

it("extends majority styles sparsely, including the last-column bottom-right corner", () => {
  const input: Workbook = { sheets: [{ id: "s", name: "Small", cells: [], size: { rows: 128, columns: 128 }, unsupportedRecords: [
    { source: "Gnumeric_XmlIO:sax", kind: "Styles", disposition: "retained", data: node("Styles", {}, [
      region({ startRow: "0", endRow: "127", startCol: "0", endCol: "127" }, "0.00"),
      region({ startRow: "0", endRow: "95", startCol: "127", endCol: "127" }, "0%")
    ]) }
  ] }] };
  const result = resizeWorkbookReferences(input, "s", { rows: 256, columns: 256 }, context());
  const records = result.sheets[0]!.unsupportedRecords!;
  const corner = records.find(r => r.kind === "StyleRange" && (r.data as { startRow: number }).startRow === 128 && (r.data as { startColumn: number }).startColumn === 128);
  expect((corner!.data as { format: string }).format).toBe("0%");
  expect(records.length).toBeLessThan(12);
});

it("deletes objects by starting anchor and retains crossing anchor geometry", () => {
  const crossing = node("SheetObjectFilled", { ObjectBound: "A1:IV256" });
  const gone = node("SheetObjectFilled", { ObjectBound: "A200:B201" });
  const input: Workbook = { sheets: [{ id: "s", name: "Small", cells: [], size: { rows: 256, columns: 256 }, unsupportedRecords: [
    { source: "Gnumeric_XmlIO:sax", kind: "Objects", disposition: "retained", data: node("Objects", {}, [crossing, gone]) }
  ] }] };
  const result = resizeWorkbookReferences(input, "s", { rows: 128, columns: 128 }, context());
  expect((result.sheets[0]!.unsupportedRecords![0]!.data as { children: ImportedValue[] }).children).toEqual([crossing]);
});

it("propagates cancellation and style work limits without returning a resized workbook", () => {
  const input: Workbook = { sheets: [{ id: "s", name: "Small", cells: [], size: { rows: 128, columns: 128 }, unsupportedRecords: [
    { source: "Gnumeric_XmlIO:sax", kind: "Styles", disposition: "retained", data: node("Styles", {}, [
      region({ startRow: "0", endRow: "127", startCol: "0", endCol: "127" }, "0.00")
    ]) }
  ] }] };
  const abort = new AbortController();
  const reason = new Error("stop resize"); abort.abort(reason);
  expect(() => resizeWorkbookReferences(input, "s", { rows: 256, columns: 256 }, { ...context(), signal: abort.signal })).toThrow(reason);
  const ctx = context();
  expect(() => resizeWorkbookReferences(input, "s", { rows: 256, columns: 256 }, { ...ctx, limits: { ...ctx.limits, workbookWork: 1 } })).toThrow(/limit/);
  expect(input.sheets[0]!.size).toEqual({ rows: 128, columns: 128 });
});

it("invalidates cached dependencies when disappearing precedents leave the sheet", () => {
  const input: Workbook = { sheets: [{ id: "s", name: "Small", cells: [], size: { rows: 256, columns: 256 } }],
    dependencies: [{ dependent: { sheet: "s", startRow: 0, endRow: 0, startColumn: 0, endColumn: 0 },
      precedent: { sheet: "s", startRow: 199, endRow: 199, startColumn: 0, endColumn: 0 } }] };
  expect(resizeWorkbookReferences(input, "s", { rows: 128, columns: 128 }, context()).dependencies).toBeUndefined();
});

it("extends generic format rectangles without needing a retained native XML style tree", () => {
  const input: Workbook = { sheets: [{ id: "s", name: "Small", cells: [], size: { rows: 128, columns: 128 }, unsupportedRecords: [
    { source: "lotus", kind: "FormatRange", disposition: "retained", data: { startRow: 0, endRow: 127, startColumn: 0, endColumn: 127, format: "0.00" } }
  ] }] };
  const result = resizeWorkbookReferences(input, "s", { rows: 256, columns: 128 }, context());
  expect(result.sheets[0]!.unsupportedRecords).toContainEqual({ source: "ssconvert-resize", kind: "StyleRange", disposition: "retained",
    data: { startRow: 128, endRow: 255, startColumn: 0, endColumn: 127, format: "0.00" } });
});

it("extends per-cell majority formatting using sparse style ranges", () => {
  const input: Workbook = { sheets: [{ id: "s", name: "Small", size: { rows: 128, columns: 128 }, cells:
    Array.from({ length: 65 }, (_, row) => ({ row, column: 0, value: { kind: "blank" as const }, format: "0%", style: { bold: true } })) }] };
  const result = resizeWorkbookReferences(input, "s", { rows: 256, columns: 128 }, context());
  expect(result.sheets[0]!.unsupportedRecords).toContainEqual({ source: "ssconvert-resize", kind: "StyleRange", disposition: "retained",
    data: { startRow: 128, endRow: 255, startColumn: 0, endColumn: 0, format: "0%", style: { bold: true } } });
  expect(result.sheets[0]!.cells).toHaveLength(65);
});

it("marks detached formulas dirty after their target is resized", () => {
  const input: Workbook = { sheets: [{ id: "s", name: "Small", cells: [], size: { rows: 256, columns: 256 } }], detachedSheets: [
    { id: "d", name: "Detached", cells: [{ row: 0, column: 0, value: { kind: "blank" }, formula: "=Small!A200" }] }
  ] };
  const result = resizeWorkbookReferences(input, "s", { rows: 128, columns: 128 }, context());
  expect(result.detachedSheets![0]!.cells[0]).toMatchObject({ formula: "=#REF!", formulaDirty: true });
});

it("uses XML and generic formatting together when choosing expansion majority", () => {
  const xml = node("Style", { Format: "0.00" });
  const input: Workbook = { sheets: [{ id: "s", name: "Small", cells: [], size: { rows: 128, columns: 128 }, unsupportedRecords: [
    { source: "Gnumeric_XmlIO:sax", kind: "Styles", disposition: "retained", data: node("Styles", {}, [
      node("StyleRegion", { startRow: "0", endRow: "127", startCol: "0", endCol: "127" }, [xml])
    ]) },
    { source: "lotus", kind: "FormatRange", disposition: "retained", data: { startRow: 0, endRow: 0, startColumn: 0, endColumn: 127, format: "0.0" } }
  ] }] };
  const result = resizeWorkbookReferences(input, "s", { rows: 256, columns: 128 }, context());
  expect(result.sheets[0]!.unsupportedRecords).toContainEqual({ source: "ssconvert-resize", kind: "StyleRange", disposition: "retained",
    data: { startRow: 128, endRow: 255, startColumn: 0, endColumn: 127, format: "0.00", style: { gnumeric: xml } } });
});

it("retains a named expression parse position in disappearing rows", () => {
  const input: Workbook = { names: [{ name: "example", expression: "=$A$1", position: { sheet: "s", row: 199, column: 0 } }],
    sheets: [{ id: "s", name: "Small", cells: [], size: { rows: 256, columns: 256 } }] };
  const result = resizeWorkbookReferences(input, "s", { rows: 128, columns: 128 }, context());
  expect(result.names).toEqual(input.names);
});

it("checks array splits in column-before-row deletion order", () => {
  const make = (startRow: number, endRow: number, startColumn: number, endColumn: number): Workbook => ({ sheets: [
    { id: "s", name: "Small", size: { rows: 256, columns: 256 }, cells: [], formulaGroups: [
      { id: "a", kind: "array", expression: "=1", range: { startRow, endRow, startColumn, endColumn } }
    ] }
  ] });
  expect(() => resizeWorkbookReferences(make(199, 200, 126, 129), "s", { rows: 128, columns: 128 }, context())).toThrow(/resize formula group/);
  expect(resizeWorkbookReferences(make(126, 129, 199, 200), "s", { rows: 128, columns: 128 }, context()).sheets[0]!.formulaGroups).toEqual([]);
});
