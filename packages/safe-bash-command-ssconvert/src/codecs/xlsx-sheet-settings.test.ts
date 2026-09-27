import { expect, it } from "vitest";
import { createZipCodec } from "@poe-code/office-package";
import { parseXmlSteps, type XmlElement } from "@poe-code/safe-fs/xml";
import { createXlsxWriter, readXlsx } from "./xlsx.js";
import { context, fixture, parts, ss } from "./xlsx.test.js";
import { metadataNode, type MetadataNode } from "./xlsx-write-support.js";
import type { ImportedValue, Workbook } from "../workbook.js";

const records = {
  sheetPr: '<sheetPr codeName="OriginalSheet" filterMode="1"><tabColor rgb="FFFF0000"/><outlinePr applyStyles="1" summaryBelow="0" summaryRight="0"/><pageSetUpPr autoPageBreaks="0" fitToPage="1"/></sheetPr>',
  sheetFormatPr: '<sheetFormatPr baseColWidth="12" defaultColWidth="22.5" defaultRowHeight="23.25" customHeight="1" zeroHeight="0" thickTop="1" thickBottom="1"/>',
  sheetProtection: '<sheetProtection sheet="1" objects="1" scenarios="1" password="ABCD" formatCells="1" formatColumns="1" formatRows="1" insertColumns="1" insertRows="1" insertHyperlinks="1" deleteColumns="1" deleteRows="1" selectLockedCells="0" sort="1" autoFilter="1" pivotTables="1" selectUnlockedCells="0"/>',
  printOptions: '<printOptions headings="1" gridLines="1" gridLinesSet="0" horizontalCentered="1" verticalCentered="1"/>',
  pageMargins: '<pageMargins left="0.1234567" right="0.7654321" top="0.35" bottom="0.45" header="0.15" footer="0.25"/>',
  pageSetup: '<pageSetup paperSize="5" orientation="landscape" scale="83" firstPageNumber="7" useFirstPageNumber="1" pageOrder="overThenDown" blackAndWhite="1" draft="1" cellComments="atEnd" errors="dash" fitToWidth="2" fitToHeight="3" horizontalDpi="300" verticalDpi="1200" copies="4"/>',
  headerFooter: '<headerFooter differentOddEven="1" differentFirst="1" scaleWithDoc="0" alignWithMargins="0"><oddHeader>&amp;L&amp;BImportant &amp;P</oddHeader><oddFooter>&amp;RFooter</oddFooter><evenHeader>Even H</evenHeader><evenFooter>Even F</evenFooter><firstHeader>First H</firstHeader><firstFooter>First F</firstFooter></headerFooter>'
};
const cells = '<sheetData><row r="2"><c r="B2"><v>7</v></c></row></sheetData>';
function xml(source: string): XmlElement {
  const parser = parseXmlSteps(source); let step = parser.next(); while (!step.done) step = parser.next(); return step.value;
}
function shape(node: XmlElement | undefined): unknown {
  if (!node) return undefined;
  return { name: node.localName, attributes: Object.fromEntries(node.attributes.filter(a => !a.name.startsWith("xmlns")).map(a => [a.name, a.value])),
    text: node.text, children: node.children.map(shape) };
}
async function worksheet(bytes: Uint8Array): Promise<XmlElement> {
  const zip = createZipCodec(), limits = { maxArchiveBytes: 100000, maxEntryBytes: 100000, maxTotalBytes: 100000,
    maxMembers: 100, maxPathBytes: 1024, maxDepth: 32, maxPaxBytes: 10000, maxTextBytes: 100000, chunkSize: 4096 };
  const archive = await zip.readZipArchive(bytes, limits, context.signal);
  const entry = archive.entries.find(entry => entry.name === "xl/worksheets/sheet1.xml")!;
  const chunks: Uint8Array[] = [];
  for await (const chunk of zip.decodeZipEntry(entry, limits, context.signal)) chunks.push(chunk);
  return xml(Buffer.concat(chunks).toString("utf8"));
}
async function original() {
  return readXlsx(await fixture(parts(records.sheetPr + records.sheetFormatPr + cells +
    records.sheetProtection + records.printOptions + records.pageMargins + records.pageSetup + records.headerFooter)), context);
}
function edited(book: Workbook): Workbook {
  return { ...book, sheets: book.sheets.map(sheet => ({ ...sheet, cells: sheet.cells.map(cell => ({ ...cell, value: { kind: "number", value: 8 } })) })) };
}
for (const edition of ["2006", "2008"] as const) {
  it.each(Object.entries(records))(`retains ${edition} nondefault %s through a cell edit`, async (name, expected) => {
    const output = await worksheet(await createXlsxWriter(edition)(edited(await original()), [], context));
    const matching = output.children.filter(node => node.localName === name);
    expect(matching).toHaveLength(1);
    expect(shape(matching[0])).toEqual(shape(xml(expected.replace("<" + name, `<${name} xmlns="${ss}"`))));
  });
  it(`does not warn about ${edition} worksheet records emitted by its own writer`, async () => {
    const book: Workbook = { sheets: [{ id: "s", name: "S", cells: [{ row: 1, column: 1, value: { kind: "number", value: 7 } }] }] };
    const input = await readXlsx(await createXlsxWriter(edition)(book, [], context), context);
    const diagnostics: string[] = [];
    const bytes = await createXlsxWriter(edition)(edited(input), [], { ...context, async diagnostic(d) { diagnostics.push(d.message); } });
    expect((await readXlsx(bytes, context)).sheets[0]!.cells[0]!.value).toEqual({ kind: "number", value: 8 });
    expect(diagnostics).toEqual([]);
  });
}
it("imports default row and column dimensions into the rendering model", async () => {
  const sheet = (await original()).sheets[0]!;
  expect(sheet.view?.defaultRowHeight).toBe(23.25);
  expect(sheet.view?.defaultColumnWidth).toBeCloseTo(22.5 * (130 / 18.5703125) * (72 / 96), 10);
});

it("applies explicit normalized print edits without losing untouched native settings", async () => {
  const input = await original(), sheet = input.sheets[0]!;
  const changed: Workbook = { ...input, sheets: [{ ...sheet, unsupportedRecords: sheet.unsupportedRecords?.map(record => {
    if (record.kind !== "PrintInformation") return record;
    const node = metadataNode(record.data)!;
    return { ...record, data: { ...node, children: node.children.map(child => child.name === "orientation" ? { ...child, text: "portrait" } : child) } as unknown as ImportedValue };
  }) ?? [] }] };
  const output = await worksheet(await createXlsxWriter("2006")(changed, [], context));
  const setup = output.children.find(node => node.localName === "pageSetup")!;
  const attrs = Object.fromEntries(setup.attributes.map(a => [a.name, a.value]));
  expect(attrs).toMatchObject({ orientation: "portrait", paperSize: "5", copies: "4", horizontalDpi: "300", verticalDpi: "1200", firstPageNumber: "7", useFirstPageNumber: "1" });
});

function updateRecord(book: Workbook, kind: string, update: (node: MetadataNode) => MetadataNode): Workbook {
  return { ...book, sheets: book.sheets.map(sheet => ({ ...sheet,
    unsupportedRecords: sheet.unsupportedRecords?.map(record => record.kind === kind
      ? { ...record, data: update(metadataNode(record.data)!) as unknown as ImportedValue } : record) ?? [] })) };
}
function attributes(node: XmlElement): Record<string, string> {
  return Object.fromEntries(node.attributes.map(a => [a.name, a.value]));
}
it("retains raw print records when no normalized print model is supplied", async () => {
  const input = await original();
  const book: Workbook = { ...input, sheets: input.sheets.map(sheet => ({ ...sheet,
    unsupportedRecords: sheet.unsupportedRecords?.filter(record => record.kind !== "PrintInformation") ?? [] })) };
  const output = await worksheet(await createXlsxWriter("2006")(book, [], context));
  for (const name of ["sheetPr", "printOptions", "pageMargins", "pageSetup", "headerFooter"] as const)
    expect(shape(output.children.find(node => node.localName === name))).toEqual(shape(xml(records[name])));
});
it("applies normalized margin and header edits while preserving other native values", async () => {
  const book = updateRecord(await original(), "PrintInformation", node => ({ ...node, children: node.children.map(child =>
    child.name === "Margins" ? { ...child, children: child.children.map(margin => margin.name === "left"
      ? { ...margin, attributes: { ...margin.attributes, Points: "54" } } : margin) }
    : child.name === "Header" ? { ...child, attributes: { Left: "", Middle: "New &[PAGE] & text", Right: "" } } : child) }));
  const output = await worksheet(await createXlsxWriter("2006")(book, [], context));
  expect(attributes(output.children.find(node => node.localName === "pageMargins")!)).toMatchObject({ left: "0.75", right: "0.7654321" });
  const hf = output.children.find(node => node.localName === "headerFooter")!;
  expect(hf.children.find(node => node.localName === "oddHeader")!.text).toBe("&CNew &P && text");
  expect(hf.children.find(node => node.localName === "firstHeader")!.text).toBe("First H");
});
it("applies normalized dimensions and protection state without replacing native flags", async () => {
  const input = await original(), sheet = input.sheets[0]!;
  const book: Workbook = { ...input, sheets: [{ ...sheet, view: { ...sheet.view, defaultRowHeight: 30,
    defaultColumnWidth: 75, gnumeric: { Protected: "0" } } }] };
  const output = await worksheet(await createXlsxWriter("2006")(book, [], context));
  const format = attributes(output.children.find(node => node.localName === "sheetFormatPr")!);
  expect(Number(format.defaultColWidth)).toBeCloseTo(75 / ((130 / 18.5703125) * (72 / 96)), 10);
  expect(format).toMatchObject({ defaultRowHeight: "30", thickTop: "1", thickBottom: "1" });
  const protection = attributes(output.children.find(node => node.localName === "sheetProtection")!);
  expect(protection.sheet === undefined || protection.sheet === "0").toBe(true);
  expect(protection).toMatchObject({ password: "ABCD", objects: "1", formatCells: "1", selectLockedCells: "0" });
});
it("preserves SHA-512 sheet protection fields and omitted operation defaults", async () => {
  const source = '<sheetProtection sheet="true" algorithmName="SHA-512" hashValue="AQIDBA==" saltValue="BQYHCA==" spinCount="100000"/>';
  const book = await readXlsx(await fixture(parts(cells + source)), context);
  const output = await worksheet(await createXlsxWriter("2008")(edited(book), [], context));
  expect(shape(output.children.find(node => node.localName === "sheetProtection"))).toEqual(shape(xml(source)));
});
it("uses base column width plus pixel padding only without an explicit default width", async () => {
  const book = await readXlsx(await fixture(parts('<sheetFormatPr baseColWidth="12" defaultRowHeight="15"/>' + cells)), context);
  expect(book.sheets[0]!.view?.defaultColumnWidth).toBeCloseTo(12 * ((130 / 18.5703125) * (72 / 96)) + 3.75, 10);
  const output = await worksheet(await createXlsxWriter("2006")(book, [], context));
  expect(attributes(output.children.find(node => node.localName === "sheetFormatPr")!)).toEqual({ baseColWidth: "12", defaultRowHeight: "15" });
});
it.each(["defaultColWidth", "baseColWidth", "defaultRowHeight"])("rejects negative %s before returning a workbook", async name => {
  await expect(readXlsx(await fixture(parts(`<sheetFormatPr ${name}="-1"/>` + cells)), context)).rejects.toMatchObject({ code: "io" });
});
it("preserves admitted worksheet settings from an alternate XLSX namespace", async () => {
  const ns = "http://schemas.openxmlformats.org/spreadsheetml/2006/7/main";
  const data = parts(records.sheetPr + cells + records.headerFooter);
  data["xl/worksheets/sheet1.xml"] = data["xl/worksheets/sheet1.xml"].replace(ss, ns);
  const output = await worksheet(await createXlsxWriter("2008")(await readXlsx(await fixture(data), context), [], context));
  expect(shape(output.children.find(node => node.localName === "headerFooter"))).toEqual(shape(xml(records.headerFooter)));
});
it("diagnoses unsupported setting fields and omits relationship IDs without their targets", async () => {
  let book = updateRecord(await original(), "pageSetup", node => ({ ...node, attributes: { ...node.attributes, "r:id": "printer", vendor: "unknown" } }));
  book = updateRecord(book, "sheetPr", node => ({ ...node, children: [...node.children,
    { name: "alien", namespace: ss, attributes: {}, text: "ignored", children: [] }] }));
  const diagnostics: string[] = [];
  const output = await worksheet(await createXlsxWriter("2006")(book, [], { ...context, async diagnostic(d) { diagnostics.push(d.message); } }));
  expect(diagnostics).toEqual(expect.arrayContaining([
    "XLSX writer does not export sheet 'Résumé' metadata attribute 'pageSetup.r:id'",
    "XLSX writer does not export sheet 'Résumé' metadata attribute 'pageSetup.vendor'",
    "XLSX writer does not export sheet 'Résumé' metadata element 'sheetPr.alien'"
  ]));
  expect(diagnostics).toHaveLength(3);
  expect(attributes(output.children.find(node => node.localName === "pageSetup")!)).not.toHaveProperty("r:id");
  expect(output.children.find(node => node.localName === "sheetPr")!.children.some(node => node.localName === "alien")).toBe(false);
});
it("warns for duplicate setting records while emitting the first record once", async () => {
  const input = await original(), sheet = input.sheets[0]!, record = sheet.unsupportedRecords!.find(record => record.kind === "pageSetup")!;
  const book: Workbook = { ...input, sheets: [{ ...sheet, unsupportedRecords: [...sheet.unsupportedRecords!, { ...record }] }] };
  const diagnostics: string[] = [];
  const output = await worksheet(await createXlsxWriter("2006")(book, [], { ...context, async diagnostic(d) { diagnostics.push(d.message); } }));
  expect(output.children.filter(node => node.localName === "pageSetup")).toHaveLength(1);
  expect(diagnostics).toEqual(["XLSX writer does not export sheet 'Résumé' record 'pageSetup'"]);
});
it("observes cancellation during a worksheet-setting loss diagnostic", async () => {
  const book = updateRecord(await original(), "pageSetup", node => ({ ...node, attributes: { ...node.attributes, "r:id": "missing" } }));
  const controller = new AbortController(), reason = { settingDiagnostic: true };
  await expect(createXlsxWriter("2006")(book, [], { ...context, signal: controller.signal,
    async diagnostic() { controller.abort(reason); } })).rejects.toBe(reason);
});
it("charges retained worksheet text before writing an archive", async () => {
  const book = updateRecord(await original(), "headerFooter", node => ({ ...node, children: node.children.map(child =>
    child.name === "firstHeader" ? { ...child, text: "x".repeat(20000) } : child) }));
  await expect(createXlsxWriter("2006")(book, [], { ...context, limits: { ...context.limits, workbookWork: 10000 } }))
    .rejects.toMatchObject({ code: "resource-limit" });
});
it("updates page-break counts after removing a break, retaining the remaining break span", async () => {
  const input = await readXlsx(await fixture(parts(cells + '<rowBreaks count="2" manualBreakCount="2"><brk id="5" min="2" max="8" man="1"/><brk id="10" min="1" max="9" man="1"/></rowBreaks>')), context);
  const book = updateRecord(input, "PrintInformation", node => ({ ...node, children: node.children.map(child => child.name === "hPageBreaks"
    ? { ...child, attributes: { count: "1" }, children: child.children.slice(1) } : child) }));
  const output = await worksheet(await createXlsxWriter("2006")(book, [], context));
  const breaks = output.children.find(node => node.localName === "rowBreaks")!;
  expect(attributes(breaks)).toEqual({ count: "1" });
  expect(breaks.children.map(attributes)).toEqual([{ id: "10", min: "1", max: "9", man: "1" }]);
});
it("retains zero default-width syntax while using the positive base width", async () => {
  const source = '<sheetFormatPr baseColWidth="12" defaultColWidth="0" defaultRowHeight="0"/>';
  const input = await readXlsx(await fixture(parts(source + cells)), context);
  expect(input.sheets[0]!.view?.defaultColumnWidth).toBeCloseTo(12 * ((130 / 18.5703125) * (72 / 96)) + 3.75, 10);
  const output = await worksheet(await createXlsxWriter("2006")(input, [], context));
  expect(shape(output.children.find(node => node.localName === "sheetFormatPr"))).toEqual(shape(xml(source)));
});
it("does not replace the default rendering width with zero base width", async () => {
  const input = await readXlsx(await fixture(parts('<sheetFormatPr baseColWidth="0" defaultColWidth="0" defaultRowHeight="0"/>' + cells)), context);
  expect(input.sheets[0]!.view).not.toHaveProperty("defaultColumnWidth");
  const output = await worksheet(await createXlsxWriter("2006")(input, [], context));
  const columns = output.children.find(node => node.localName === "cols")!;
  expect(columns.children.every(node => Number(attributes(node).width) > 0)).toBe(true);
});
