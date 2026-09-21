import { expect, it } from "vitest";
import { Volume } from "memfs";
import { createZipCodec } from "@poe-code/office-package";
import { createEngine } from "../engine.js";
import { runCommand } from "../cli.js";
import type { CapabilityContext } from "../contracts.js";
import { readXlsx, probeXlsx } from "./xlsx.js";
import { writeGnumeric } from "./gnumeric.js";

export const context: CapabilityContext = { signal: new AbortController().signal, own() {},
  environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 100000, outputBytes: 100000, cells: 1000, sheets: 3, operations: 1000 } };
export const ss = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
export const rel = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
export const pkg = "http://schemas.openxmlformats.org/package/2006/relationships";
export async function fixture(parts: Readonly<Record<string, string>>, compression: "store" | "deflate" = "store") {
  const zip = createZipCodec();
  const limits = { maxArchiveBytes: 100000, maxEntryBytes: 100000, maxTotalBytes: 100000,
    maxMembers: 100, maxPathBytes: 1024, maxDepth: 32, maxPaxBytes: 10000, maxTextBytes: 100000, chunkSize: 4096 };
  const entries = [];
  for (const [name, text] of Object.entries(parts)) entries.push(await zip.makeZipEntry(name, new TextEncoder().encode(text),
    { modified: new Date("2000-01-01Z"), mode: 0o644, directory: false, symlink: false, compression }, limits, context.signal));
  return zip.writeZipArchive({ entries, comment: new Uint8Array() }, limits, context.signal);
}
export function parts(sheet: string, workbook = `<workbook xmlns="${ss}" xmlns:r="${rel}"><workbookPr date1904="1"/><sheets><sheet name="Résumé" sheetId="7" r:id="s"/></sheets></workbook>`) {
  return { "_rels/.rels": `<Relationships xmlns="${pkg}"><Relationship Id="w" Type="${rel}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    "xl/workbook.xml": workbook,
    "xl/_rels/workbook.xml.rels": `<Relationships xmlns="${pkg}"><Relationship Id="s" Type="${rel}/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`,
    "xl/worksheets/sheet1.xml": `<worksheet xmlns="${ss}">${sheet}</worksheet>` };
}
it.each(["store", "deflate"] as const)("imports an OOXML template using injected memfs bytes (%s)", async compression => {
  const bytes = await fixture(parts('<sheetData><row r="2"><c r="B2" t="inlineStr"><is><t>a&amp;b</t></is></c><c r="C2"><f>1+2</f><v>3</v></c></row></sheetData><mergeCells><mergeCell ref="A4:B5"/></mergeCells>'), compression);
  const volume = new Volume(); volume.writeFileSync("/book.xltx", bytes);
  const engine = createEngine({ codecs: [], environment: context.environment, limits: context.limits,
    filesystem: { async read(uri) { return [new Uint8Array(volume.readFileSync(uri) as Uint8Array)]; },
      async write(uri, data) { volume.writeFileSync(uri, data); } } });
  try {
    const book = await engine.readWorkbook({ kind: "resource", uri: "/book.xltx" }, {}, context);
    expect(book).toMatchObject({ dateSystem: "1904", sheets: [{ name: "Résumé", cells: [
      { row: 1, column: 1, value: { kind: "string", value: "a&b" } },
      { row: 1, column: 2, formula: "=1+2", cachedResult: { kind: "number", value: 3 } }],
      merges: [{ startRow: 3, startColumn: 0, endRow: 4, endColumn: 1 }] }] });
  } finally { await engine.dispose(); }
});
it("resolves shared strings and custom formats through workbook relationships", async () => {
  const data = parts('<sheetData><row><c r="A1" t="s"><v>0</v></c><c r="B1" s="1"><v>42</v></c><c r="C1" t="b"><v>1</v></c></row></sheetData>');
  data["xl/_rels/workbook.xml.rels"] = data["xl/_rels/workbook.xml.rels"].replace('</Relationships>', `<Relationship Id="strings" Type="${rel}/sharedStrings" Target="sharedStrings.xml"/><Relationship Id="styles" Type="${rel}/styles" Target="styles.xml"/></Relationships>`);
  const book = await readXlsx(await fixture({ ...data,
    "xl/sharedStrings.xml": `<sst xmlns="${ss}"><si><r><rPr><b/></rPr><t>ab</t></r><r><t>cd</t></r></si></sst>`,
    "xl/styles.xml": `<styleSheet xmlns="${ss}"><numFmts><numFmt numFmtId="164" formatCode="0.000"/></numFmts><cellXfs><xf numFmtId="0"/><xf numFmtId="164"/></cellXfs></styleSheet>` }), context);
  expect(book.sheets[0]!.cells).toMatchObject([{ value: { kind: "string", value: "abcd" }, richText: [{ start: 0, end: 2 }] },
    { value: { kind: "number", value: 42 }, format: "0.000" }, { value: { kind: "boolean", value: true } }]);
  expect(new TextDecoder().decode(await writeGnumeric(book, [], context))).toContain('bold=1:0:2');
});
it("uses the native workbook-member probe rather than extension or content type", async () => {
  expect(await probeXlsx(await fixture({ "xl/workbook.xml": "garbage" }), context)).toBe(true);
  expect(await probeXlsx(await fixture({ "xl/workbook.bin": "garbage" }), context)).toBe(false);
});
it("rejects external workbook relationships, traversal, entities and aggregate inflation", async () => {
  const data = parts('');
  for (const target of ["../../outside.xml", "%2e%2e/%2e%2e/outside.xml", "https://example.com/workbook.xml"]) {
    await expect(readXlsx(await fixture({ ...data, "_rels/.rels": `<Relationships xmlns="${pkg}"><Relationship Id="w" Type="${rel}/officeDocument" Target="${target}"/></Relationships>` }), context)).rejects.toThrow();
  }
  await expect(readXlsx(await fixture({ ...data, "xl/workbook.xml": `<!DOCTYPE workbook [<!ENTITY x "boom">]><workbook xmlns="${ss}">&x;</workbook>` }), context)).rejects.toThrow();
  await expect(readXlsx(await fixture({ ...data, "large": "a".repeat(8000) }, "deflate"), { ...context, limits: { ...context.limits, inputBytes: 4000 } })).rejects.toThrow();
});
it("copies borrowed bytes and observes cancellation", async () => {
  const bytes = await fixture(parts('<sheetData><row><c r="A1"><v>12</v></c></row></sheetData>'));
  const reading = readXlsx(bytes, context); bytes.fill(0);
  expect((await reading).sheets[0]!.cells[0]!.value).toEqual({ kind: "number", value: 12 });
  const controller = new AbortController(); const reason = new Error("cancelled"); controller.abort(reason);
  await expect(readXlsx(new Uint8Array(), { ...context, signal: controller.signal })).rejects.toBe(reason);
});
it("matches native namespace scanning at sheet declarations and its absence at cells", async () => {
  const drawing = "http://schemas.openxmlformats.org/drawingml/2006/main";
  const book = await readXlsx(await fixture(parts(`<sheetData><row><c xmlns="${drawing}" r="A1"><v>99</v></c><c r="B1"><v>7</v></c></row></sheetData>`)), context);
  expect(book.sheets[0]!.cells.map(cell => [cell.column, cell.value])).toEqual([[0, { kind: "number", value: 99 }], [1, { kind: "number", value: 7 }]]);
  const workbook = `<workbook xmlns="${ss}" xmlns:r="${rel}"><sheets><sheet xmlns="${drawing}" name="Foreign" r:id="s"/><sheet name="Actual" r:id="s"/></sheets></workbook>`;
  expect((await readXlsx(await fixture(parts("<sheetData/>", workbook)), context)).sheets.map(sheet => sheet.name)).toEqual(["Actual"]);
});
it("ignores known foreign namespace print metadata", async () => {
  const book = await readXlsx(await fixture(parts('<sheetData/><pageMargins xmlns="http://schemas.openxmlformats.org/drawingml/2006/main" left="999"/>')), context);
  expect(book.sheets[0]!.unsupportedRecords?.some(record => record.kind === "PrintInformation") ?? false).toBe(false);
});
it.each(["C", "C.UTF-8"])("preserves native shared-string warning bytes under %s", async locale => {
  const input = parts('<sheetData><row><c r="A1" t="s"><v>0\u00a0</v></c></row></sheetData>', `<workbook xmlns="${ss}" xmlns:r="${rel}"><sheets><sheet name="S" r:id="s"/></sheets></workbook>`);
  const bytes = await fixture(input), diagnostics: string[] = [];
  await readXlsx(bytes, { ...context, environment: { ...context.environment, locale }, async diagnostic(d) {
    diagnostics.push(new TextDecoder().decode(d.bytes ?? new TextEncoder().encode(d.message + "\n")));
  } });
  expect(diagnostics).toEqual([`S!A1 : Invalid sst ref '0${locale === "C" ? "?" : "\u00a0"}'\n`]);
});
it("emits exactly one native newline for invalid defined-name expressions through the command engine", async () => {
  const workbook = `<workbook xmlns="${ss}" xmlns:r="${rel}"><sheets><sheet name="S" r:id="s"/></sheets><definedNames><definedName name="Broken">!#REF!</definedName></definedNames></workbook>`;
  const volume = new Volume(); volume.writeFileSync("/book.xlsx", await fixture(parts("<sheetData/>", workbook)));
  const engine = createEngine({ codecs: [], environment: context.environment, limits: context.limits,
    filesystem: { async read(uri) { return [new Uint8Array(volume.readFileSync(uri) as Uint8Array)]; },
      async write(uri, bytes) { volume.writeFileSync(uri, bytes); } } });
  const errors: string[] = [];
  try {
    const result = await runCommand(["-T", "Gnumeric_XmlIO:sax:0", "/book.xlsx", "/output.xml"], engine, {
      signal: context.signal, stdout: { async write() {} }, stderr: { async write(bytes) { errors.push(new TextDecoder().decode(bytes)); } }
    });
    expect(result.exitCode).toBe(0);
    expect(errors.join("")).toBe("At A1: '!#REF!' Invalid expression\n");
    expect(volume.existsSync("/output.xml")).toBe(true);
  } finally { await engine.dispose(); }
});
it.each(["http://schemas.openxmlformats.org/spreadsheetml/2006/main",
  "http://schemas.openxmlformats.org/spreadsheetml/2006/7/main", "http://schemas.openxmlformats.org/spreadsheetml/2006/5/main",
  "http://schemas.microsoft.com/office/excel/2006/2", "http://schemas.microsoft.com/office/spreadsheetml/2009/9/main"])("imports source-supported namespace %s", async namespace => {
  const data = parts('<sheetData><row><c><v>42</v></c></row></sheetData>');
  const aliased = Object.fromEntries(Object.entries(data).map(([path, value]) => [path, value.split(ss).join(namespace)]));
  expect((await readXlsx(await fixture(aliased), context)).sheets[0]!.cells[0]!.value).toEqual({ kind: "number", value: 42 });
});
it("imports workbook scoped names, native reserved names and date1904 on", async () => {
  const workbook = `<workbook xmlns="${ss}" xmlns:r="${rel}"><workbookPr date1904="on"/><sheets><sheet name="S" sheetId="1" r:id="s"/></sheets><definedNames><definedName name="Global">1+2</definedName><definedName name="_xlnm.Print_Area" localSheetId="0">S!$A$1:$B$2</definedName><definedName name="Empty"/><definedName name="_xlnm.Print_Area">!#REF!</definedName></definedNames></workbook>`;
  const book = await readXlsx(await fixture(parts('', workbook)), context);
  expect(book.dateSystem).toBe("1904");
  expect(book.names).toEqual([{ name: "Global", expression: "=1+2" },
    { name: "Print_Area", expression: "=S!$A$1:$B$2", sheet: "sheet-1" }, { name: "Empty", expression: "=#REF!" }]);
});
it("exports interpreted comments, print settings and sheet protection", async () => {
  const data = parts('<sheetData/><sheetProtection sheet="1"/><pageMargins left="0.1" right="0.2" top="0.3" bottom="0.4" header="0.5" footer="0.6"/><pageSetup orientation="landscape" paperSize="9" scale="75"/><headerFooter><oddHeader>&amp;LHeader &amp;P</oddHeader><oddFooter>&amp;LFooter</oddFooter></headerFooter><rowBreaks><brk id="2" man="1"/></rowBreaks>');
  const book = await readXlsx(await fixture({ ...data,
    "xl/worksheets/_rels/sheet1.xml.rels": `<Relationships xmlns="${pkg}"><Relationship Id="c" Type="${rel}/comments" Target="../comments.xml"/></Relationships>`,
    "xl/comments.xml": `<comments xmlns="${ss}"><authors><author>Ada  </author></authors><commentList><comment ref="B2" authorId="0"><text><t>original note</t></text></comment></commentList></comments>` }), context);
  const output = new TextDecoder().decode(await writeGnumeric(book, [], context));
  expect(output).toContain('Protected="1"');
  expect(output).toContain('<gnm:top Points="21.6" PrefUnit="mm"/>');
  expect(output).toContain('<gnm:Scale type="percentage" percentage="75"/>');
  expect(output).toContain('<gnm:orientation>landscape</gnm:orientation>');
  expect(output).toContain('<gnm:Header Left="Header &amp;[PAGE]" Middle="" Right=""/>');
  expect(output).toContain('<gnm:paper>iso_a4</gnm:paper>');
  expect(output).toContain('<gnm:break pos="2" type="manual"/>');
  expect(output).toContain('Author="Ada" Text="original note"');
});
it("uses the source writer's four significant digits for imported print points", async () => {
  const book = await readXlsx(await fixture(parts('<sheetData/><pageMargins top="0.123456"/>')), context);
  expect(new TextDecoder().decode(await writeGnumeric(book, [], context))).toContain('Points="8.889"');
});
it("imports row sizing, source column width conversion and measured view effects", async () => {
  const book = await readXlsx(await fixture(parts('<sheetViews><sheetView zoomScale="125" showGridLines="0" showFormulas="1" showZeros="0" showRowColHeaders="0" topLeftCell="C3"><pane state="frozen" xSplit="1" ySplit="2" topLeftCell="D4"/></sheetView></sheetViews><cols><col min="2" max="3" width="18.5703125" customWidth="1" hidden="1" outlineLevel="2" collapsed="1"/></cols><sheetData><row r="3" ht="22" customHeight="1" hidden="1"/></sheetData>')), context);
  expect(book.sheets[0]!.columns).toMatchObject([{ index: 1, sizePoints: 97.5, hidden: true, outlineLevel: 2, collapsed: true }, { index: 2, sizePoints: 97.5 }]);
  expect(book.sheets[0]!.rows).toMatchObject([{ index: 2, sizePoints: 22, hidden: true }]);
  const xml = new TextDecoder().decode(await writeGnumeric(book, [], context));
  expect(xml).toContain('DisplayFormulas="1" HideZero="1" HideGrid="1" HideColHeader="1" HideRowHeader="1"');
  expect(xml).toContain('<gnm:Zoom>1.25</gnm:Zoom>');
  expect(xml).toContain('<gnm:SheetLayout TopLeft="D4">');
  expect(xml).toContain('FrozenTopLeft="C3" UnfrozenTopLeft="D5"');
});
it("retains the native custom-filter field rather than claiming value-list filtering", async () => {
  const book = await readXlsx(await fixture(parts('<sheetData/><autoFilter ref="A1:B2"><filterColumn colId="1"><customFilters and="1"><customFilter operator="lessThan" val="3"/><customFilter operator="greaterThan" val="15"/></customFilters></filterColumn></autoFilter>')), context);
  const xml = new TextDecoder().decode(await writeGnumeric(book, [], context));
  expect(xml).toContain('<gnm:Filter Area="A1:B2">');
  expect(xml).toContain('<gnm:Field Index="1" Type="expr" Op0="gt" Value0="40" ValueType0="15"/>');
});
it("imports namespace-qualified core document properties through root relationships", async () => {
  const data = parts('');
  data["_rels/.rels"] = data["_rels/.rels"].replace('</Relationships>', '<Relationship Id="props" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>');
  const book = await readXlsx(await fixture({ ...data, "docProps/core.xml": '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Original</dc:title><dc:creator>Ada</dc:creator><cp:lastModifiedBy>Bob</cp:lastModifiedBy><cp:keywords>one two</cp:keywords></cp:coreProperties>' }), context);
  expect(book.properties).toMatchObject({ "dc:title": "Original", "meta:initial-creator": "Ada", "dc:creator": "Bob", "dc:keywords": ["one", "two"] });
});
it("imports hyperlinks as owned styles without fetching external targets", async () => {
  const data = parts('<sheetData><row><c r="A1" t="inlineStr"><is><t>original</t></is></c></row></sheetData><hyperlinks><hyperlink ref="A1" r:id="h" tooltip="tip" display="ignored"/><hyperlink ref="B2" location="S!C3"/></hyperlinks>');
  data["xl/worksheets/sheet1.xml"] = data["xl/worksheets/sheet1.xml"].replace('<worksheet ', `<worksheet xmlns:r="${rel}" `);
  const book = await readXlsx(await fixture({ ...data, "xl/worksheets/_rels/sheet1.xml.rels": `<Relationships xmlns="${pkg}"><Relationship Id="h" Type="${rel}/hyperlink" Target="https://example.com/" TargetMode="External"/></Relationships>` }), context);
  expect(book.sheets[0]!.cells[0]!.value).toEqual({ kind: "string", value: "original" });
  const xml = new TextDecoder().decode(await writeGnumeric(book, [], context));
  expect(xml).toContain('type="GnmHLinkURL" target="https://example.com/" tip="tip"');
  expect(xml).toContain('type="GnmHLinkCurWB" target="S!C3"');
});
it("charges cell/metadata comparisons against the workbook work budget", async () => {
  const cells = Array.from({ length: 10 }, () => '<c><v>1</v></c>').join('');
  const links = Array.from({ length: 10 }, () => '<hyperlink ref="A1:J1" location="S!A1"/>').join('');
  await expect(readXlsx(await fixture(parts(`<sheetData><row>${cells}</row></sheetData><hyperlinks>${links}</hyperlinks>`)),
    { ...context, limits: { ...context.limits, workbookWork: 100 } })).rejects.toMatchObject({ code: "resource-limit" });
});
it("applies inherited column/row styles with explicit cell precedence", async () => {
  const data = parts('<cols><col min="1" max="2" style="1"/></cols><sheetData><row r="1"><c><v>1</v></c></row><row r="2" customFormat="1" s="2"><c><v>2</v></c><c s="0"><v>3</v></c></row></sheetData>');
  data["xl/_rels/workbook.xml.rels"] = data["xl/_rels/workbook.xml.rels"].replace('</Relationships>', `<Relationship Id="styles" Type="${rel}/styles" Target="styles.xml"/></Relationships>`);
  const book = await readXlsx(await fixture({ ...data, "xl/styles.xml": `<styleSheet xmlns="${ss}"><cellXfs><xf numFmtId="0"/><xf numFmtId="2"/><xf numFmtId="9"/></cellXfs></styleSheet>` }), context);
  expect(book.sheets[0]!.cells.map(c => c.format)).toEqual(["0.00", "0%", "General"]);
});
it("reuses the native duplicate sheet identity and last relationship", async () => {
  const workbook = `<workbook xmlns="${ss}" xmlns:r="${rel}"><sheets><sheet name="S" sheetId="1" r:id="unused"/><sheet name="S" sheetId="2" r:id="s"/></sheets></workbook>`;
  const book = await readXlsx(await fixture(parts('<sheetData><row><c><v>42</v></c></row></sheetData>', workbook)), context);
  expect(book.sheets).toHaveLength(1); expect(book.sheets[0]!.cells[0]!.value).toEqual({ kind: "number", value: 42 });
});
it("uses native conversion failure diagnostics for unsupported workbook root namespaces", async () => {
  const workbook = '<workbook xmlns="http://purl.oclc.org/ooxml/spreadsheetml/main"/>';
  const engine = createEngine({ codecs: [], environment: context.environment, limits: context.limits });
  try {
    await expect(engine.convert({ input: { kind: "stream", filename: "/strict.xlsx", source: [await fixture(parts('', workbook))] },
      exportType: "Gnumeric_XmlIO:sax:0", destination: { kind: "stream", sink: { async write() {} } } }, context))
      .rejects.toMatchObject({ exitCode: 1, code: "io", message: "Loading file:///strict.xlsx failed" });
  } finally { await engine.dispose(); }
});
it("warns for an invalid ordinary name while preserving its previous valid expression", async () => {
  const messages: string[] = [];
  const workbook = `<workbook xmlns="${ss}" xmlns:r="${rel}"><sheets><sheet name="S" r:id="s"/></sheets><definedNames><definedName name="Print_Area">S!$A$1:$B$2</definedName><definedName name="Print_Area">!#REF!</definedName></definedNames></workbook>`;
  const book = await readXlsx(await fixture(parts('', workbook)), { ...context, async diagnostic(d) { messages.push(d.message); } });
  expect(book.names).toEqual([{ name: "Print_Area", expression: "=S!$A$1:$B$2" }]);
  expect(messages).toEqual(["At A1: '!#REF!' Invalid expression\n"]);
});
