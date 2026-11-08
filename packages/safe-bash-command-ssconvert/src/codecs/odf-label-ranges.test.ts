import { expect, it } from "vitest";
import { readOdf, createOdfWriter } from "./odf.js";
import { context, content, fixture } from "./odf.test.js";
import { unpackOdf } from "./odf-write.test.js";
import { snapshotWorkbook, type Workbook } from "../workbook.js";
import { createEngine } from "../engine.js";
import { recalculateWorkbook } from "../formulas/evaluator.js";
import { readBiff, createBiffWriter } from "./biff.js";

const range = (startRow: number, endRow: number, startColumn: number, endColumn: number) =>
  ({ startRow, endRow, startColumn, endColumn });
const pairs = [
  { axis: "row" as const, labels: range(0, 2, 0, 1), data: range(0, 2, 3, 8) },
  { axis: "column" as const, labels: range(0, 0, 0, 3), data: range(3, 70000, 0, 3) },
  { axis: "row" as const, labels: range(0, 2, 0, 1), data: range(0, 2, 4, 4) }
];
const declarations = '<table:label-ranges>' +
  '<table:label-range table:label-cell-range-address="$\'O\'\'Brien\'.$A$1:.$B$3" table:data-cell-range-address="$\'O\'\'Brien\'.$D$1:.$I$3" table:orientation="row"/>' +
  '<table:label-range table:label-cell-range-address="$\'O\'\'Brien\'.$A$1:.$D$1" table:data-cell-range-address="$\'O\'\'Brien\'.$A$4:.$D$70001" table:orientation="column"/>' +
  '<table:label-range table:label-cell-range-address="$\'O\'\'Brien\'.$A$1:.$B$3" table:data-cell-range-address="$\'O\'\'Brien\'.$E$1:.$E$3" table:orientation="row"/>' +
  '</table:label-ranges>';
async function source(settings = "", labels = declarations) {
  return fixture({ mimetype: "application/vnd.oasis.opendocument.spreadsheet", "content.xml": content(
    settings + '<table:table table:name="O\'Brien"/><table:table table:name="Other"/>' + labels) });
}

it("imports ordered native ODF label/data declarations without allocating the covered cells", async () => {
  const diagnostics: string[] = [];
  const book = await readOdf(await source(), { ...context, async diagnostic(d) { diagnostics.push(d.code); } });
  expect(book.sheets[0]!.labelRanges).toEqual(pairs);
  expect(book.sheets[1]!.labelRanges).toBeUndefined();
  expect(book.sheets[0]!.cells).toEqual([]);
  expect(book.sheets[0]!.size!.rows).toBeGreaterThan(70000);
  expect(snapshotWorkbook(book, context.limits).sheets[0]!.labelRanges).toEqual(pairs);
  expect(diagnostics).not.toContain("odf-unknown-element");
  expect(book.unsupportedRecords?.some(r => r.kind === "label-ranges")).toBe(false);
});

it.each(["o''brien", "O''BRIEN"])("binds label declarations to sheet display names ignoring case: %s", async spelling => {
  const labels = declarations.replaceAll("O''Brien", spelling)
    .replace(":.$B$3", () => ":$'O''Brien'.$B$3");
  const book = await readOdf(await source("", labels), context);
  expect(book.sheets[0]!.name).toBe("O'Brien");
  expect(book.sheets[0]!.labelRanges).toEqual(pairs);
  expect(book.sheets[1]!.labelRanges).toBeUndefined();
});

it.each([[undefined, true], ["true", true], ["false", false]] as const)(
  "imports automatic label lookup %s", async (value, expected) => {
    const settings = value === undefined ? "" : `<table:calculation-settings table:automatic-find-labels="${value}"/>`;
    expect((await readOdf(await source(settings, ""), context)).automaticLabelLookup).toBe(expected);
  });

it.each(["0", "1", "yes"])("rejects invalid ODF lookup boolean %s", async value => {
  await expect(readOdf(await source(`<table:calculation-settings table:automatic-find-labels="${value}"/>`, ""), context))
    .rejects.toMatchObject({ code: "io" });
});

it.each(["strict", "extended"] as const)("exports %s native metadata from workbook identities", async profile => {
  const book: Workbook = { automaticLabelLookup: true, sheets: [
    { id: "stable-id", name: "O'Brien", cells: [], labelRanges: pairs }
  ] };
  const bytes = await createOdfWriter(profile)(book, [], context);
  const xml = (await unpackOdf(bytes)).parts.get("content.xml")!;
  expect(xml).toContain('table:automatic-find-labels="true"');
  expect(xml.split("<table:label-range ")).toHaveLength(4);
  expect(xml).toContain("O''Brien");
  expect(xml).not.toContain("stable-id");
  expect(xml).toContain(".$A$1:.$B$3");
  expect(xml).toContain(".$D$1:.$I$3");
  const reopened = await readOdf(bytes, context);
  expect(reopened.sheets[0]!.labelRanges).toEqual(pairs);
  expect(reopened.automaticLabelLookup).toBe(true);
});

it("does not warn of label metadata loss when exporting ODF through the engine", async () => {
  const engine = createEngine({ codecs: [], environment: context.environment, limits: context.limits });
  const diagnostics: string[] = [];
  try {
    const book = await engine.readWorkbook({ kind: "stream", filename: "labels.ods", source: [await source()] }, {}, context);
    await engine.writeWorkbook(book, { kind: "stream", sink: { async write() {} } },
      { exportType: "Gnumeric_OpenCalc:odf" }, { ...context, async diagnostic(d) { diagnostics.push(d.code); } });
    expect(diagnostics).not.toContain("label-range-loss-warning");
    expect(book.sheets[0]!.labelRanges).toEqual(pairs);
  } finally { await engine.dispose(); }
});

it("uses the imported explicit data interval for recalculation across a blank gap", async () => {
  const imported = await readOdf(await source('<table:calculation-settings table:automatic-find-labels="false"/>'), context);
  const sheet = imported.sheets[0]!;
  const book: Workbook = { ...imported, sheets: [{ ...sheet, cells: [
    { row: 0, column: 0, value: { kind: "string", value: "Sales" } },
    { row: 0, column: 3, value: { kind: "number", value: 2 } },
    { row: 0, column: 8, value: { kind: "number", value: 3 } },
    { row: 4, column: 3, formula: "=SUM(@row:$A$1)", formulaDirty: true, value: { kind: "number", value: 999 } }
  ] }] };
  expect(recalculateWorkbook(book, context, true).sheets[0]!.cells.at(-1)!.value).toEqual({ kind: "number", value: 5 });
});

it("transports BIFF8 label declarations through ODF and back to native BIFF records", async () => {
  const book: Workbook = { automaticLabelLookup: true, sheets: [{ id: "s", name: "S", cells: [], labelRanges: [
    { axis: "row", labels: range(0, 2, 0, 0), data: range(0, 2, 1, 255) },
    { axis: "column", labels: range(0, 0, 2, 3), data: range(1, 65535, 2, 3) }
  ] }] };
  const imported = await readBiff(await createBiffWriter(8)(book, [], context), context);
  const odf = await readOdf(await createOdfWriter("strict")(imported, [], context), context);
  const reopened = await readBiff(await createBiffWriter(8)(odf, [], context), context);
  expect(reopened.sheets[0]!.labelRanges).toEqual(book.sheets[0]!.labelRanges);
  expect(reopened.automaticLabelLookup).toBe(true);
});

it("does not publish a workbook with malformed label metadata", async () => {
  const engine = createEngine({ codecs: [], environment: context.environment, limits: context.limits });
  const bytes = await source("", declarations.replace('table:orientation="row"', ''));
  let writes = 0;
  try {
    await expect(engine.convert({ input: { kind: "stream", filename: "bad.ods", source: [bytes] },
      exportType: "Gnumeric_OpenCalc:odf", destination: { kind: "stream", sink: { async write() { writes++; } } } }, context))
      .rejects.toMatchObject({ code: "io" });
    expect(writes).toBe(0);
  } finally { await engine.dispose(); }
});

it("reads legacy OpenOffice label declarations with their original namespace", async () => {
  const xml = content('<table:table table:name="O\'Brien"/>' + declarations)
    .replace('<office:spreadsheet>', '').replace('</office:spreadsheet>', '')
    .replaceAll('urn:oasis:names:tc:opendocument:xmlns:office:1.0', 'http://openoffice.org/2000/office')
    .replaceAll('urn:oasis:names:tc:opendocument:xmlns:table:1.0', 'http://openoffice.org/2000/table');
  const bytes = await fixture({ mimetype: 'application/vnd.sun.xml.calc', 'content.xml': xml });
  expect((await readOdf(bytes, context)).sheets[0]!.labelRanges).toEqual(pairs);
});

it.each([
  ['table:orientation="row"', 'table:orientation="diagonal"'],
  ['table:orientation="row"', ''],
  [".$A$1:.$B$3", ".$B$3:.$A$1"],
  [".$D$1:.$I$3", ".$D$1:.$I$0"],
  [".$D$1:.$I$3", ".$D$1:.$I$999999999"],
  ['table:label-cell-range-address=', 'foreign:label-cell-range-address=']
])("rejects malformed label metadata %s", async (before, after) => {
  const labels = declarations.replace(before, after).replace("<table:label-ranges>", '<table:label-ranges xmlns:foreign="urn:foreign">');
  await expect(readOdf(await source("", labels), context)).rejects.toMatchObject({ code: "io" });
});
