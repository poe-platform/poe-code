import { expect, it } from "vitest";
import { Volume } from "memfs";
import { createEngine } from "../engine.js";
import { probeSpreadsheetML, readSpreadsheetML } from "./spreadsheetml.js";
import type { CapabilityContext } from "../contracts.js";
import { readGnumeric, writeGnumeric } from "./gnumeric.js";

const ns = "urn:schemas-microsoft-com:office:spreadsheet";
function fixture(body: string, filename = "/book.xml") {
  const volume = new Volume();
  volume.writeFileSync(filename, `<Workbook xmlns="${ns}" xmlns:ss="${ns}">${body}</Workbook>`);
  const engine = createEngine({ codecs: [], environment: { env: {}, locale: "C", timezone: "UTC" },
    limits: { inputBytes: 100000, outputBytes: 100000, cells: 1000, sheets: 3, operations: 1000 },
    filesystem: { async read(uri, signal) { signal.throwIfAborted(); return [new Uint8Array(volume.readFileSync(uri) as Uint8Array)]; },
      async write(uri, bytes, signal) { signal.throwIfAborted(); volume.writeFileSync(uri, bytes); } } });
  return { engine, volume, input: { kind: "resource" as const, uri: filename }, operation: { signal: new AbortController().signal } };
}
it("imports sparse SpreadsheetML through the shared SDK and converts with injected file I/O", async () => {
  const f = fixture('<Worksheet ss:Name="Sheet1"><Table><Row ss:Index="3"><Cell ss:Index="2"><Data ss:Type="String">a&amp;b</Data></Cell><Cell ss:Formula="=RC[-1]&amp;&quot;!&quot;"><Data ss:Type="String">a&amp;b!</Data></Cell></Row></Table></Worksheet>');
  try {
    const book = await f.engine.readWorkbook(f.input, {}, f.operation);
    expect(book.sheets).toMatchObject([{ name: "Sheet1", cells: [
      { row: 2, column: 1, value: { kind: "string", value: "a&b" } },
      { row: 2, column: 2, formula: '=B3&"!"', cachedResult: { kind: "string", value: "a&b!" } }
    ] }]);
    const result = await f.engine.convert({ input: f.input, destination: { kind: "resource", uri: "/out.csv" }, exportType: "Gnumeric_stf:stf_csv" }, f.operation);
    expect(result.exitCode).toBe(0);
    expect(f.volume.readFileSync("/out.csv", "utf8")).toContain("a&b");
    expect(f.engine.listServices("write").some(s => s.id === "Gnumeric_Excel:excel_xml")).toBe(false);
  } finally { await f.engine.dispose(); }
});

const context: CapabilityContext = { signal: new AbortController().signal, own() {}, environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 100000, outputBytes: 100000, cells: 1000, sheets: 3, operations: 1000 } };
function source(body: string) { return new TextEncoder().encode(`<Workbook xmlns="${ns}" xmlns:ss="${ns}">${body}</Workbook>`); }
it("matches Default-only inheritance, ignored Parent, conditional merges and sparse axes", async () => {
  const book = await readSpreadsheetML(source('<Styles><Style ss:ID="Default"><Font ss:Bold="1"/><NumberFormat ss:Format="Fixed"/></Style><Style ss:ID="parent"><NumberFormat ss:Format="Percent"/></Style><Style ss:ID="child" ss:Parent="parent"/></Styles><Worksheet ss:Name="S"><Table><Column ss:Index="2" ss:Span="2" ss:Width="42" ss:Hidden="1"/><Row ss:Index="4" ss:Span="3" ss:Height="22"><Cell ss:StyleID="child" ss:MergeAcross="1" ss:MergeDown="1"><Data ss:Type="Number">0.5</Data></Cell><Cell ss:MergeAcross="1"><Data ss:Type="String">unmerged</Data></Cell></Row><Row><Cell><Data ss:Type="Number">7</Data></Cell></Row></Table></Worksheet>'), context);
  expect(book.sheets[0]).toMatchObject({ columns: [{ index: 1, sizePoints: 42, hidden: true }, { index: 2 }, { index: 3 }], rows: [{ index: 3, sizePoints: 22 }, { index: 4 }, { index: 5 }],
    merges: [{ startRow: 3, startColumn: 0, endRow: 4, endColumn: 1 }], cells: [{ row: 3, column: 0, format: "0.00", style: { Font: { Bold: 1 } } }, { row: 3, column: 2 }, { row: 4, column: 0 }] });
});
it("matches native date serials and keeps invalid dates as strings", async () => {
  const values = ["1900-01-01T00:00:00", "1900-02-28T12:00:00", "1900-03-01T00:00:00", "2000-02-29T06:30:45.5", "2001-02-29T00:00:00", "2000-01-01"];
  const book = await readSpreadsheetML(source('<Worksheet ss:Name="S"><Table><Row>' + values.map(v => `<Cell><Data ss:Type="DateTime">${v}</Data></Cell>`).join("") + '</Row></Table></Worksheet>'), context);
  expect(book.sheets[0]!.cells.map(c => c.value)).toEqual([{ kind: "number", value: 1 }, { kind: "number", value: 59.5 }, { kind: "number", value: 61 },
    { kind: "number", value: 36585.27135995371 }, { kind: "string", value: values[4] }, { kind: "string", value: values[5] }]);
});
it("does not mistake Gnumeric XML for SpreadsheetML or dispatch on extension alone", async () => {
  const f = fixture('<Worksheet ss:Name="S"><Table><Row><Cell><Data ss:Type="Number">4</Data></Cell></Row></Table></Worksheet>', "/book.bin");
  try {
    // Native HTML's priority-100 prefix probe recognizes this early <Table>;
    // SpreadsheetML's priority-1 content probe needs an explicit selection here.
    expect((await f.engine.readWorkbook(f.input, { importType: "Gnumeric_Excel:excel_xml" }, f.operation)).sheets[0]!.name).toBe("S");
    const gnumeric = '<g:Workbook xmlns:g="http://www.gnumeric.org/v10.dtd"><g:Sheets><g:Sheet><g:Name>Native</g:Name><g:Cells><g:Cell Row="0" Col="0" ValueType="40">9</g:Cell></g:Cells></g:Sheet></g:Sheets></g:Workbook>';
    f.volume.writeFileSync("/book.xml", gnumeric);
    expect(await probeSpreadsheetML(new TextEncoder().encode(gnumeric), context)).toBe(false);
    expect((await f.engine.readWorkbook({ kind: "resource", uri: "/book.xml" }, {}, f.operation)).sheets[0]!.name).toBe("Native");
  } finally { await f.engine.dispose(); }
});
it("warns for ignored comments, flattens rich strings and ignores supported no-op print nodes", async () => {
  const messages: string[] = [];
  const book = await readSpreadsheetML(source('<Worksheet ss:Name="S"><Table><Row><Cell ss:HRef="https://example.com"><Data ss:Type="String">a<B xmlns="http://www.w3.org/TR/REC-html40">b</B>c</Data><Comment><Data>note</Data></Comment></Cell></Row></Table><WorksheetOptions xmlns="urn:schemas-microsoft-com:office:excel"><PageSetup><Layout Orientation="Landscape"/><Header Data="Title"/></PageSetup><Print><PaperSizeIndex>9</PaperSizeIndex></Print></WorksheetOptions></Worksheet>'), { ...context, async diagnostic(d) { messages.push(d.message); } });
  expect(book.sheets[0]!.cells[0]!.value).toEqual({ kind: "string", value: "abc" });
  expect(book.sheets[0]!.unsupportedRecords).toBeUndefined();
  expect(messages).toEqual(["Unexpected element 'Comment' in state : \n\tWorkbook -> Worksheet -> Table -> Row -> Cell\n"]);
});
it("imports supported document properties using the shared metadata keys", async () => {
  const book = await readSpreadsheetML(source('<DocumentProperties xmlns="urn:schemas-microsoft-com:office:office"><Author>First</Author><LastAuthor>Last</LastAuthor><Title>Title</Title><Keywords>one  two</Keywords><Company>C</Company><Created>2000-01-01T00:00:00Z</Created></DocumentProperties><Worksheet ss:Name="S"/>'), context);
  expect(book.properties).toEqual({ "meta:initial-creator": "First", "dc:creator": "Last", "dc:title": "Title", "dc:keywords": ["one"], "dc:publisher": "C", "meta:creation-date": "2000-01-01T00:00:00Z" });
  const exported = await writeGnumeric(book, [], context);
  expect(new TextDecoder().decode(exported)).toContain('<meta:keyword>one</meta:keyword>');
  const replay = await readGnumeric(exported, context);
  expect(replay.properties).toEqual(book.properties);
});
it("preserves imported font, alignment, fills and borders through Gnumeric export", async () => {
  const book = await readSpreadsheetML(source('<Styles><Style ss:ID="s"><Font ss:Bold="1" ss:Size="14" ss:Color="#112233"/><Alignment ss:Horizontal="Right" ss:WrapText="1"/><Interior ss:Color="#AABBCC" ss:Pattern="Solid"/><Borders><Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="2" ss:Color="#000000"/></Borders></Style></Styles><Worksheet ss:Name="S"><Table><Row><Cell ss:StyleID="s"><Data ss:Type="Number">5</Data></Cell></Row></Table></Worksheet>'), context);
  const output = new TextDecoder().decode(await writeGnumeric(book, [], context));
  expect(output).toContain('Bold="1"'); expect(output).toContain('Unit="14"');
  expect(output).toContain('Fore="1111:2222:3333"'); expect(output).toContain('HAlign="GNM_HALIGN_RIGHT"');
  expect(output).toContain('Back="AAAA:BBBB:CCCC"'); expect(output).toContain('<gnm:Bottom Style="1" Color="0:0:0"/>');
  const replay = await readGnumeric(new TextEncoder().encode(output), context);
  expect(replay.sheets[0]!.cells[0]!.style?.gnumeric).toBeDefined();
});
it("imports native-supported selection and unconditioned autofilter records", async () => {
  const book = await readSpreadsheetML(source('<Worksheet ss:Name="S"><Table><Row><Cell><Data ss:Type="Number">4</Data></Cell></Row></Table><WorksheetOptions xmlns="urn:schemas-microsoft-com:office:excel"><Panes><Pane><Number>3</Number><ActiveRow>2</ActiveRow><ActiveCol>1</ActiveCol><RangeSelection>R3C2:R4C4,R7C1</RangeSelection></Pane></Panes></WorksheetOptions><AutoFilter xmlns="urn:schemas-microsoft-com:office:excel" xmlns:x="urn:schemas-microsoft-com:office:excel" x:Range="R1C1:R4C3"/></Worksheet>'), context);
  const output = new TextDecoder().decode(await writeGnumeric(book, [], context));
  expect(output).toContain('<gnm:Selections CursorCol="1" CursorRow="2">');
  expect(output).toContain('<gnm:Selection startCol="1" startRow="2" endCol="3" endRow="3"/>');
  expect(output).toContain('<gnm:Selection startCol="0" startRow="6" endCol="0" endRow="6"/>');
  expect(output).toContain('<gnm:Filter Area="A1:C4"/>');
});
it.each(["UTF-16LE", "UTF-16BE"] as const)("imports declared %s XML bytes without host decoding", async encoding => {
  const text = `<?xml version="1.0" encoding="UTF-16"?><Workbook xmlns="${ns}" xmlns:ss="${ns}"><Worksheet ss:Name="S"><Table><Row><Cell><Data>Résumé</Data></Cell></Row></Table></Worksheet></Workbook>`;
  const data = new Uint8Array(text.length * 2 + 2), view = new DataView(data.buffer), little = encoding === "UTF-16LE";
  view.setUint16(0, 0xfeff, little);
  for (let i = 0; i < text.length; i++) view.setUint16(2 + i * 2, text.charCodeAt(i), little);
  expect(await probeSpreadsheetML(data, context)).toBe(true);
  expect((await readSpreadsheetML(data, context)).sheets[0]!.cells[0]!.value).toEqual({ kind: "string", value: "Résumé" });
});
it("accepts the legacy alternate namespace only when explicitly selected", async () => {
  const xml = source('<Worksheet ss:Name="S"><Table><Row><Cell><Data ss:Type="Number">1</Data></Cell></Row></Table></Worksheet>');
  const alternate = new TextEncoder().encode(new TextDecoder().decode(xml).split(ns).join("http://schemas.microsoft.com/office/excel/2003/xml"));
  expect(await probeSpreadsheetML(alternate, context)).toBe(false);
  expect((await readSpreadsheetML(alternate, context)).sheets[0]!.cells[0]!.value).toEqual({ kind: "number", value: 1 });
});
it("imports declared Latin-1 XML with original byte decoding", async () => {
  const xml = `<?xml version="1.0" encoding="ISO-8859-1"?><Workbook xmlns="${ns}" xmlns:ss="${ns}"><Worksheet ss:Name="S"><Table><Row><Cell><Data>Résumé</Data></Cell></Row></Table></Worksheet></Workbook>`;
  const bytes = Uint8Array.from(xml, c => c.charCodeAt(0));
  expect(await probeSpreadsheetML(bytes, context)).toBe(true);
  expect((await readSpreadsheetML(bytes, context)).sheets[0]!.cells[0]!.value).toEqual({ kind: "string", value: "Résumé" });
});
it("preserves native diagnostic order across semantic warnings and unknown elements", async () => {
  const messages: string[] = [];
  await readSpreadsheetML(source('<Worksheet ss:Name="S"><Table><Row><Cell><Data ss:Type="Number">bad</Data></Cell><Cell><Data>text</Data><Comment/></Cell></Row></Table></Worksheet>'), { ...context, async diagnostic(d) { messages.push(d.message); } });
  expect(messages).toEqual(["S!A1 : Invalid content of ss:data element, expected number, received 'bad'\n", "Unexpected element 'Comment' in state : \n\tWorkbook -> Worksheet -> Table -> Row -> Cell\n"]);
});
it("imports the named date/time formats with the captured GOffice magic identifiers", async () => {
  const names = ["General Date", "Long Date", "Medium Date", "Short Date", "Long Time", "Medium Time", "Short Time"];
  const book = await readSpreadsheetML(source('<Styles>' + names.map((n, i) => `<Style ss:ID="s${i}"><NumberFormat ss:Format="${n}"/></Style>`).join("") + '</Styles><Worksheet ss:Name="S"><Table><Row>' + names.map((_, i) => `<Cell ss:StyleID="s${i}"><Data ss:Type="Number">123.25</Data></Cell>`).join("") + '</Row></Table></Worksheet>'), context);
  expect(book.sheets[0]!.cells.map(c => c.format)).toEqual(["[$-f8fa]m/d/yy h:mm", "[$-f800]dddd, mmmm dd, yyyy", "[$-f8f1]d-mmm-yy", "[$-f8f2]m/d/yy", "[$-f400]h:mm:ss AM/PM", "[$-f4f1]h:mm AM/PM", "[$-f4f2]hh:mm"]);
});
it("consumes repeated Data elements in order and clears a formula once its cache is consumed", async () => {
  const book = await readSpreadsheetML(source('<Worksheet ss:Name="S"><Table><Row><Cell><Data ss:Type="Number">1</Data><Data>2</Data></Cell><Cell ss:Formula="=1+2"><Data ss:Type="Number">9</Data><Data ss:Type="String">second</Data></Cell><Cell><Data ss:Type="Boolean"/></Cell></Row></Table></Worksheet>'), context);
  expect(book.sheets[0]!.cells).toMatchObject([{ column: 0, value: { kind: "number", value: 2 } }, { column: 1, value: { kind: "string", value: "second" } }, { column: 2, value: { kind: "blank" } }]);
  expect(book.sheets[0]!.cells[1]!.formula).toBeUndefined();
});
it("preserves nonstandard Error text through the native Gnumeric XML representation", async () => {
  const book = await readSpreadsheetML(source('<Worksheet ss:Name="S"><Table><Row><Cell><Data ss:Type="Error">#BOGUS!</Data></Cell><Cell><Data ss:Type="Error"/></Cell></Row></Table></Worksheet>'), context);
  const exported = await writeGnumeric(book, [], context);
  expect(new TextDecoder().decode(exported)).toContain('#&quot;#BOGUS!&quot;');
  expect(new TextDecoder().decode(exported)).toContain('#&quot;&quot;');
  expect((await readGnumeric(exported, context)).sheets[0]!.cells.map(c => c.value)).toEqual(book.sheets[0]!.cells.map(c => c.value));
});
it("reports native deterministic malformed-document warning and error bodies", async () => {
  const messages: string[] = [];
  await expect(readSpreadsheetML(new TextEncoder().encode(`<Workbook xmlns="${ns}"><Worksheet`), { ...context, async diagnostic(d) { messages.push(d.message); } })).rejects.toMatchObject({ message: "E XML document not well formed!", exitCode: 1 });
  expect(messages).toEqual(["Document likely damaged.\n"]);
});
it("preserves default axis dimensions when only styles or visibility are imported", async () => {
  const book = await readSpreadsheetML(source('<Styles><Style ss:ID="s"><Font ss:Bold="1"/></Style></Styles><Worksheet ss:Name="S"><Table><Column ss:StyleID="s"/><Column ss:Hidden="1"/><Row ss:StyleID="s"><Cell><Data ss:Type="Number">1</Data></Cell></Row><Row ss:Hidden="1"/></Table></Worksheet>'), context);
  const exported = await writeGnumeric(book, [], context);
  const replay = await readGnumeric(exported, context);
  expect(replay.sheets[0]!.columns).toMatchObject([{ index: 1, sizePoints: 48, hidden: true }]);
  expect(replay.sheets[0]!.rows).toMatchObject([{ index: 1, sizePoints: 12.75, hidden: true }]);
  expect(new TextDecoder().decode(exported)).not.toContain('Unit="0"');
});
it("serializes simple qualified R1C1 references with native sheet quoting", async () => {
  const book = await readSpreadsheetML(source('<Worksheet ss:Name="S"><Table><Row><Cell><Data ss:Type="Number">7</Data></Cell><Cell ss:Formula="=S!R1C1+1"><Data ss:Type="Number">8</Data></Cell></Row></Table></Worksheet><Names><NamedRange ss:Name="Global" ss:RefersTo="=S!R1C1"/></Names>'), context);
  expect(book.sheets[0]!.cells[1]!.formula).toBe("=S!$A$1+1");
  expect(book.names).toMatchObject([{ name: "Global", expression: "=S!$A$1" }]);
});
it("quotes each formula qualifier independently using native sheet-name rules", async () => {
    const input = `<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
      <Worksheet ss:Name="S"/><Worksheet ss:Name="123"/><Worksheet ss:Name="With space"/>
      <Worksheet ss:Name="Out"><Table><Row><Cell ss:Formula="=S!R1C1+&apos;123&apos;!R1C1+&apos;With space&apos;!R1C1"><Data ss:Type="Number">3</Data></Cell></Row></Table></Worksheet>
    </Workbook>`;
    const book = await readSpreadsheetML(new TextEncoder().encode(input), { ...context, limits: { ...context.limits, sheets: 4 } });
    expect(book.sheets[3]!.cells[0]!.formula).toBe("=S!$A$1+'123'!$A$1+'With space'!$A$1");
  });
