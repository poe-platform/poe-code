import { expect, it } from "vitest";
import { readOdf, createOdfWriter } from "./odf.js";
import { context, content, fixture } from "./odf.test.js";
import { unpackOdf } from "./odf-write.test.js";
import { snapshotWorkbook, type Workbook } from "../workbook.js";
import { recalculateWorkbook } from "../formulas/evaluator.js";
import { dirtyWorkbook } from "../workbook/updates/recalculation.js";
import { resizeWorkbookReferences } from "../workbook/resize.js";
import { renameWorkbookSheet, moveWorkbookSheet, remapWorkbookSheets } from "../formulas/workbook.js";
import { createBiffWriter } from "./biff.js";

const range = (startRow: number, endRow: number, startColumn: number, endColumn: number) =>
  ({ startRow, endRow, startColumn, endColumn });
const number = (row: number, column: number, value: number) => ({ row, column, value: { kind: "number" as const, value } });
function book(axis: "column" | "row" = "column"): Workbook {
  const column = axis === "column", anchor = column ? "A$1" : "$A1";
  return { automaticLabelLookup: false, sheets: [
    { id: "labels", name: "Labels", size: { rows: 128, columns: 128 }, cells: [
      { row: 0, column: 0, value: { kind: "string", value: "Sales" } }, number(1, 0, 1000), number(0, 1, 2000)
    ], labelRanges: [{ axis, labels: range(0, 0, 0, 0), data: column ? range(1, 4, 2, 2) : range(2, 2, 1, 4), dataSheet: "data" }] },
    { id: "data", name: "O'Brien", size: { rows: 256, columns: 256 }, cells: column
      ? [number(1, 0, 2), number(4, 0, 3), number(1, 2, 900)]
      : [number(0, 1, 2), number(0, 4, 3), number(2, 1, 900)] },
    { id: "output", name: "Output", cells: [
      { ...number(0, 5, 999), formula: `=SUM(@${axis}.odf.quoted:Labels!${anchor})`, formulaDirty: true },
      { ...number(1, 1, 999), formula: `=@${axis}.odf.quoted:Labels!${anchor}+0`, formulaDirty: true }
    ] }
  ] };
}
const results = (value: Workbook) => value.sheets.find(s => s.name === "Output")!.cells.map(c => c.value);

it.each(["column", "row"] as const)("evaluates remote %s data using the physical label axis, not rectangle offsets", axis => {
  expect(results(recalculateWorkbook(book(axis), context, true))).toEqual([{ kind: "number", value: 5 }, { kind: "number", value: 2 }]);
});

it("imports a forward data-sheet declaration and evaluates native quoted label syntax", async () => {
  const bytes = await fixture({ mimetype: "application/vnd.oasis.opendocument.spreadsheet", "content.xml": content(
    '<table:table table:name="Labels"><table:table-row><table:table-cell office:value-type="string"><text:p>Sales</text:p></table:table-cell></table:table-row></table:table>' +
    '<table:table table:name="Data"><table:table-row/><table:table-row><table:table-cell office:value-type="float" office:value="2"/></table:table-row><table:table-row table:number-rows-repeated="2"/><table:table-row><table:table-cell office:value-type="float" office:value="3"/></table:table-row></table:table>' +
    '<table:table table:name="Output"><table:table-row><table:table-cell table:formula="of:=SUM(\'Sales\')" office:value-type="float" office:value="999"/></table:table-row></table:table>' +
    '<table:label-ranges><table:label-range table:label-cell-range-address="$Labels.$A$1" table:data-cell-range-address="$Data.$A$2:.$A$5" table:orientation="column"/></table:label-ranges>') });
  const imported = await readOdf(bytes, context);
  expect(imported.sheets[0]!.labelRanges).toEqual([{ axis: "column", labels: range(0, 0, 0, 0), data: range(1, 4, 0, 0), dataSheet: imported.sheets[1]!.id }]);
  expect(imported.sheets[0]!.size!.rows).toBe(65536);
  expect(imported.sheets[1]!.size!.rows).toBe(65536);
  expect(results(recalculateWorkbook(imported, context, true))).toEqual([{ kind: "number", value: 5 }]);
});

it.each(["strict", "extended"] as const)("exports %s label/data sheet names and round-trips their identities", async profile => {
  const bytes = await createOdfWriter(profile)(book(), [], context);
  const xml = (await unpackOdf(bytes)).parts.get("content.xml")!;
  expect(xml).toContain('table:data-cell-range-address="$\'O\'\'Brien\'.$C$2:.$C$5"');
  const reopened = await readOdf(bytes, context);
  expect(reopened.sheets[0]!.labelRanges![0]!.dataSheet).toBe(reopened.sheets[1]!.id);
  expect(results(recalculateWorkbook(reopened, context, true))).toEqual([{ kind: "number", value: 5 }, { kind: "number", value: 2 }]);
});

it("propagates remote blank-cell and formula-data edits without volatile queuing", () => {
  const clean = recalculateWorkbook(book(), context, true);
  const edited = { ...clean, sheets: clean.sheets.map(s => s.id !== "data" ? s : { ...s,
    cells: [...s.cells, { ...number(2, 0, 99), formula: "=3*4", formulaDirty: true }] }) };
  const dirty = dirtyWorkbook(edited, [{ sheet: "data", ...range(2, 2, 0, 0) }], context);
  expect(dirty.sheets[2]!.cells[0]!.formulaDirty).toBe(true);
  expect(results(recalculateWorkbook(dirty, context, { force: false, queueVolatile: false }))[0]).toEqual({ kind: "number", value: 17 });
});

it("validates data against its own forward-declared sheet size", () => {
  const input = book();
  const labels = { ...input.sheets[0]!, labelRanges: [{ ...input.sheets[0]!.labelRanges![0]!, data: range(1, 200, 0, 0) }] };
  expect(snapshotWorkbook({ ...input, sheets: [labels, ...input.sheets.slice(1)] }, context.limits).sheets[0]!.labelRanges![0]!.data.endRow).toBe(200);
  for (const dataSheet of ["missing", "", 12]) {
    const bad = { ...labels, labelRanges: [{ ...labels.labelRanges[0]!, dataSheet }] };
    expect(() => snapshotWorkbook({ ...input, sheets: [bad, ...input.sheets.slice(1)] } as Workbook, context.limits)).toThrow();
  }
});

it("clips remote data only when its target shrinks and drops declarations whose data disappears", () => {
  const input = book();
  const labels = { ...input.sheets[0]!, size: { rows: 256, columns: 256 }, labelRanges: [
    { ...input.sheets[0]!.labelRanges![0]!, data: range(1, 200, 0, 0) },
    { ...input.sheets[0]!.labelRanges![0]!, data: range(128, 200, 0, 0) }
  ] };
  const original = { ...input, sheets: [labels, ...input.sheets.slice(1)] };
  const owner = resizeWorkbookReferences(original, "labels", { rows: 128, columns: 128 }, context);
  expect(owner.sheets[0]!.labelRanges!.map(p => p.data.endRow)).toEqual([200, 200]);
  const target = resizeWorkbookReferences(original, "data", { rows: 128, columns: 128 }, context);
  expect(target.sheets[0]!.labelRanges).toEqual([{ ...labels.labelRanges[0]!, data: range(1, 127, 0, 0) }]);
});

it("preserves data identity across rename, tab move and workbook merge remapping", () => {
  const renamed = renameWorkbookSheet(book(), "data", "Renamed", context);
  const moved = moveWorkbookSheet(renamed, "data", 0, context);
  const remapped = remapWorkbookSheets(moved, new Map([["data", { id: "new-data", name: "Merged" }]]), context);
  expect(remapped.sheets.find(s => s.id === "labels")!.labelRanges![0]!.dataSheet).toBe("new-data");
  expect(results(recalculateWorkbook(remapped, context, true))[0]).toEqual({ kind: "number", value: 5 });
});

it("refuses BIFF8 export even when remote data coordinates match its inferred interval", async () => {
  const input = book();
  const sheets = input.sheets.slice(0, 2).map(s => ({ ...s, size: { rows: 65536, columns: 256 }, cells: [],
    ...(s.id === "labels" ? { labelRanges: [{ ...s.labelRanges![0]!, data: range(1, 65535, 0, 0) }] } : {}) }));
  await expect(createBiffWriter(8)({ sheets }, [], context)).rejects.toMatchObject({ code: "unsupported-feature" });
});

it("grows only the referenced sheet for a sparse remote declaration", async () => {
  const bytes = await fixture({ mimetype: "application/vnd.oasis.opendocument.spreadsheet", "content.xml": content(
    '<table:table table:name="Labels"/><table:table table:name="Data"/>' +
    '<table:label-ranges><table:label-range table:label-cell-range-address="$Labels.$A$1" table:data-cell-range-address="$Data.$A$2:.$A$70001" table:orientation="column"/></table:label-ranges>') });
  const imported = await readOdf(bytes, context);
  expect(imported.sheets.map(s => s.size!.rows)).toEqual([65536, 131072]);
  expect(imported.sheets.map(s => s.cells)).toEqual([[], []]);
});

it("rejects data outside the target grid and projected label axes outside that grid", () => {
  const input = book(), owner = input.sheets[0]!;
  expect(() => snapshotWorkbook({ ...input, sheets: [{ ...owner, labelRanges: [
    { ...owner.labelRanges![0]!, data: range(1, 256, 0, 0) }
  ] }, ...input.sheets.slice(1)] }, context.limits)).toThrow();
  const projected: Workbook = { ...input, sheets: [{ ...owner, size: { rows: 256, columns: 256 },
    cells: [{ row: 0, column: 200, value: { kind: "string", value: "Sales" } }],
    labelRanges: [{ ...owner.labelRanges![0]!, labels: range(0, 0, 200, 200) }] },
    { ...input.sheets[1]!, size: { rows: 128, columns: 128 } },
    { ...input.sheets[2]!, cells: [{ ...number(0, 0, 999), formula: "=SUM(@column:Labels!GS$1)" }] }
  ] };
  expect(results(recalculateWorkbook(projected, context, true))).toEqual([{ kind: "error", value: "#REF!" }]);
});

it("preserves remote dependencies through named expressions and array groups", () => {
  const input = book();
  const named: Workbook = { ...input, names: [{ name: "Total", expression: "=SUM(@column.odf.quoted:Labels!A$1)",
    position: { sheet: "output", row: 0, column: 0 } }], sheets: [...input.sheets.slice(0, 2), {
      ...input.sheets[2]!, cells: [], formulaGroups: [{ id: "array", kind: "array", expression: "=Total", range: range(0, 0, 0, 0) }]
    }] };
  const clean = recalculateWorkbook(named, context, true);
  expect(results(clean)).toEqual([{ kind: "number", value: 5 }]);
  const edited = { ...clean, sheets: clean.sheets.map(s => s.id !== "data" ? s : { ...s, cells: [...s.cells, number(2, 0, 4)] }) };
  const dirty = dirtyWorkbook(edited, [{ sheet: "data", ...range(2, 2, 0, 0) }], context);
  expect(dirty.sheets[2]!.cells[0]!.formulaDirty).toBe(true);
  expect(results(recalculateWorkbook(dirty, context, { force: false, queueVolatile: false }))).toEqual([{ kind: "number", value: 9 }]);
});

it("updates detached label owners when a visible data sheet is resized or rehomed", () => {
  const input = book(), detached = { ...input.sheets[0]!, labelRanges: [{ ...input.sheets[0]!.labelRanges![0]!, data: range(1, 200, 0, 0) }] };
  const value = { sheets: [input.sheets[1]!], detachedSheets: [detached] };
  expect(resizeWorkbookReferences(value, "data", { rows: 128, columns: 128 }, context)
    .detachedSheets![0]!.labelRanges![0]!.data.endRow).toBe(127);
  expect(remapWorkbookSheets(value, new Map([["data", { id: "merged", name: "Merged" }]]), context)
    .detachedSheets![0]!.labelRanges![0]!.dataSheet).toBe("merged");
});

it("refuses ODF publication when the data sheet is detached", async () => {
  const input = book();
  const value = { ...input, sheets: [input.sheets[0]!], detachedSheets: [input.sheets[1]!] };
  expect(snapshotWorkbook(value, context.limits).sheets[0]!.labelRanges![0]!.dataSheet).toBe("data");
  await expect(createOdfWriter("strict")(value, [], context)).rejects.toMatchObject({ code: "unsupported-feature" });
});

it.each(["column", "row"] as const)("uses workbook-wide Calc %s boundaries without filtering data sheets", axis => {
  const column = axis === "column";
  for (const owner of ["local", "remote"]) for (const dataSheet of [undefined, "local", "remote"]) {
    const pair = { axis, labels: range(0, 0, 1, 1),
      data: column ? range(2, 4, 0, 1) : range(0, 1, 2, 4),
      ...(dataSheet === undefined ? {} : { dataSheet }) };
    // A row declaration's label is on another row so the A1 anchor stays automatic.
    if (!column) pair.labels = range(1, 1, 0, 0);
    const local = { id: "local", name: "Local", cells: [
      { row: 0, column: 0, value: { kind: "string" as const, value: "Automatic" } },
      ...[10, 20, 30].map((value, i) => number(column ? i + 1 : 0, column ? 0 : i + 1, value))
    ], ...(owner === "local" ? { labelRanges: [pair] } : {}) };
    const remote = { id: "remote", name: "Remote", cells: [], ...(owner === "remote" ? { labelRanges: [pair] } : {}) };
    for (const semantics of ["", ".odf"]) {
      const value: Workbook = { automaticLabelLookup: true, sheets: [local, remote, { id: "output", name: "Output", cells: [
        { ...number(5, 5, 999), formula: `=SUM(@${axis}${semantics}:Local!$A$1)`, formulaDirty: true }
      ] }] };
      expect(results(recalculateWorkbook(value, context, true))).toEqual([
        { kind: "number", value: semantics === ".odf" ? 60 : 10 }
      ]);
    }
  }
});
