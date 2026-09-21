import { describe, expect, it } from "vitest";
import type { CapabilityContext, Diagnostic } from "../contracts.js";
import { writeGnumeric } from "./gnumeric.js";
import { probeSpreadsheetML, readSpreadsheetML } from "./spreadsheetml.js";

const namespace = "urn:schemas-microsoft-com:office:spreadsheet";
const bytes = (body: string) => new TextEncoder().encode(`<Workbook xmlns="${namespace}" xmlns:ss="${namespace}">${body}</Workbook>`);
function context(limits: Partial<CapabilityContext["limits"]> = {}) {
  const diagnostics: Diagnostic[] = [];
  const controller = new AbortController();
  const value: CapabilityContext = { signal: controller.signal, environment: { env: {}, locale: "C", timezone: "UTC" },
    limits: { inputBytes: 100000, outputBytes: 100000, cells: 100, sheets: 3, operations: 100, ...limits },
    own() {}, async diagnostic(d) { diagnostics.push(d); } };
  return { value, diagnostics, controller };
}
const worksheet = (data: string) => `<Worksheet ss:Name="S"><Table><Row><Cell>${data}</Cell></Row></Table></Worksheet>`;

describe("independent SpreadsheetML stress review", () => {
  it("warns when Boolean content cannot be converted, preserving its text", async () => {
    const c = context();
    const book = await readSpreadsheetML(bytes(worksheet('<Data ss:Type="Boolean">banana</Data>')), c.value);
    expect(book.sheets[0]!.cells[0]!.value).toEqual({ kind: "string", value: "banana" });
    expect(c.diagnostics.map(d => d.message)).toEqual(["S!A1 : Invalid content of ss:data element, received 'banana'\n"]);
  });
  it("matches captured native Boolean numeric fallbacks and nonfinite numbers", async () => {
    const c = context();
    const book = await readSpreadsheetML(bytes('<Worksheet ss:Name="S"><Table><Row>' +
      ['0', '1', '2'].map(v => `<Cell><Data ss:Type="Boolean">${v}</Data></Cell>`).join('') +
      '<Cell><Data ss:Type="Number">0x10</Data></Cell><Cell><Data ss:Type="Number">NaN</Data></Cell><Cell><Data ss:Type="Number">INF</Data></Cell></Row></Table></Worksheet>'), c.value);
    expect(book.sheets[0]!.cells.map(cell => cell.value)).toEqual([
      { kind: "number", value: 0 }, { kind: "number", value: 1 }, { kind: "number", value: 2 },
      { kind: "number", value: 0 }, { kind: "error", value: "#NUM!" }, { kind: "error", value: "#NUM!" }
    ]);
    expect(c.diagnostics).toHaveLength(4);
  });
  it("serializes relative formulas at the indexed destination coordinate", async () => {
    const book = await readSpreadsheetML(bytes('<Worksheet ss:Name="S"><Table><Row ss:Index="3"><Cell ss:Index="4" ss:Formula="=RC[-1]+1"><Data ss:Type="Number">5</Data></Cell></Row></Table></Worksheet>'), context().value);
    expect(book.sheets[0]!.cells[0]).toMatchObject({ row: 2, column: 3, formula: "=C3+1" });
  });
  it("honors document order for workbook names and style definitions", async () => {
    const c = context();
    const book = await readSpreadsheetML(bytes('<Names><NamedRange ss:Name="Early" ss:RefersTo="=S!R1C1"/></Names>' +
      '<Worksheet ss:Name="S"><Table><Row><Cell ss:StyleID="Later"><Data>v</Data></Cell></Row></Table></Worksheet>' +
      '<Styles><Style ss:ID="Later"><NumberFormat ss:Format="0.00"/></Style></Styles>' +
      '<Names><NamedRange ss:Name="Late" ss:RefersTo="=S!R1C1"/></Names>'), c.value);
    expect(book.names?.map(name => name.name)).toEqual(["Late"]);
    expect(c.diagnostics.map(d => d.message)).toEqual(["'S!R1C1' Unknown sheet 'S'\n", "Early = =S!R1C1\n", "Late = =S!R1C1\n"]);
    expect(book.sheets[0]!.cells[0]!.format).toBeUndefined();
  });
  it("retains style-only cells for exporters and charges their cell allocation", async () => {
    const input = bytes('<Styles><Style ss:ID="s"><Font ss:Bold="1" ss:Color="#FF0000"/></Style></Styles><Worksheet ss:Name="S"><Table><Row><Cell ss:StyleID="s"/></Row></Table></Worksheet>');
    const book = await readSpreadsheetML(input, context().value);
    expect(book.sheets[0]!.cells[0]).toMatchObject({ row: 0, column: 0, value: { kind: "blank" }, style: { gnumeric: { name: "Style" } } });
    await expect(readSpreadsheetML(input, context({ cells: 0 }).value)).rejects.toMatchObject({ code: "resource-limit" });
  });
  it("rejects row metadata and merged regions beyond sheet coordinates", async () => {
    await expect(readSpreadsheetML(bytes('<Worksheet ss:Name="S"><Table><Row ss:Index="1048577" ss:Height="10"/></Table></Worksheet>'), context().value)).rejects.toMatchObject({ code: "resource-limit" });
    await expect(readSpreadsheetML(bytes('<Worksheet ss:Name="S"><Table><Row><Cell ss:MergeAcross="16384"><Data>x</Data></Cell></Row></Table></Worksheet>'), context().value)).rejects.toMatchObject({ code: "resource-limit" });
  });
  it("bounds metadata range coordinates and metadata work", async () => {
    const input = bytes('<Worksheet ss:Name="S"><AutoFilter xmlns="urn:schemas-microsoft-com:office:excel" xmlns:x="urn:schemas-microsoft-com:office:excel" x:Range="R1C1:R1048577C1"/></Worksheet>');
    await expect(readSpreadsheetML(input, context().value)).rejects.toMatchObject({ code: "resource-limit" });
    await expect(readSpreadsheetML(bytes('<Worksheet ss:Name="S"><Table/></Worksheet>'), context({ workbookWork: 1 }).value)).rejects.toMatchObject({ code: "resource-limit" });
  });
  it("emits Data start-attribute warnings before nested unknown elements", async () => {
    const c = context();
    await readSpreadsheetML(bytes(worksheet('<Data ss:Type="Bogus"><Unknown/>text</Data>')), c.value);
    expect(c.diagnostics.map(d => d.code)).toEqual(["spreadsheetml-content", "spreadsheetml-unknown-element"]);
  });
  it("rejects exponent and hexadecimal integer attribute spellings", async () => {
    const c = context();
    const book = await readSpreadsheetML(bytes('<Worksheet ss:Name="S"><Table><Row ss:Index="1e2"><Cell ss:Index="0x10"><Data>x</Data></Cell></Row></Table></Worksheet>'), c.value);
    expect(book.sheets[0]!.cells[0]).toMatchObject({ row: 0, column: 0 });
    expect(c.diagnostics.map(d => d.message)).toEqual(["S : Invalid attribute 'Index', expected integer, received '1e2'\n", "S!A1 : Invalid attribute 'Index', expected integer, received '0x10'\n"]);
  });
  it("keeps the current column after a nonpositive explicit Column Index", async () => {
    const book = await readSpreadsheetML(bytes('<Worksheet ss:Name="S"><Table><Column ss:Index="3" ss:Width="11"/><Column ss:Index="0" ss:Width="12"/></Table></Worksheet>'), context().value);
    expect(book.sheets[0]!.columns?.map(c => c.index)).toEqual([2, 3]);
  });
  it("fails intersecting explicit-style merged regions with the measured error", async () => {
    const input = bytes('<Styles><Style ss:ID="s"/></Styles><Worksheet ss:Name="S"><Table><Row><Cell ss:StyleID="s" ss:MergeAcross="1"><Data>a</Data></Cell><Cell ss:Index="2" ss:StyleID="s" ss:MergeAcross="1"><Data>b</Data></Cell></Row></Table></Worksheet>');
    await expect(readSpreadsheetML(input, context().value)).rejects.toMatchObject({ code: "io", message: "E There is already a merged region that intersects\nS!B1:C1" });
  });
  it("drops unknown-sheet cell formulas while retaining their cached values", async () => {
    const c = context();
    const book = await readSpreadsheetML(bytes('<Worksheet ss:Name="S"><Table><Row><Cell ss:Formula="=Missing!R1C1"><Data ss:Type="Number">3</Data></Cell><Cell ss:Formula="=S!R1C1"><Data ss:Type="Number">3</Data></Cell></Row></Table></Worksheet>'), c.value);
    expect(book.sheets[0]!.cells[0]!.formula).toBeUndefined();
    expect(book.sheets[0]!.cells[1]!.formula).toBeDefined();
    expect(c.diagnostics.map(d => d.message)).toEqual(["S!A1 : 'Missing!R1C1' Unknown sheet 'Missing'\n"]);
  });
  it("rejects hexadecimal floating attributes while accepting decimal exponents", async () => {
    const c = context();
    const book = await readSpreadsheetML(bytes('<Worksheet ss:Name="S"><Table><Column ss:Width="0x10"/><Column ss:Width="3e1"/></Table></Worksheet>'), c.value);
    expect(book.sheets[0]!.columns?.map(c => c.sizePoints)).toEqual([undefined, 30]);
    expect(c.diagnostics.map(d => d.message)).toEqual(["S : Invalid attribute 'Width', expected number, received '0x10'\n"]);
  });
  it("retains inherited borders when a child style overrides one side", async () => {
    const book = await readSpreadsheetML(bytes('<Styles><Style ss:ID="Default"><Borders><Border ss:Position="Left" ss:LineStyle="Continuous" ss:Color="#000000"/></Borders></Style><Style ss:ID="s"><Borders><Border ss:Position="Bottom" ss:LineStyle="Double" ss:Color="#FF0000"/></Borders></Style></Styles><Worksheet ss:Name="S"><Table><Row><Cell ss:StyleID="s"><Data>x</Data></Cell></Row></Table></Worksheet>'), context().value);
    expect(book.sheets[0]!.cells[0]!.style?.StyleBorder).toEqual({ Left: { Style: 7, Color: "#000000" }, Bottom: { Style: 6, Color: "#FF0000" } });
  });
  it("warns for invalid style enums and retains inherited values", async () => {
    const c = context();
    const book = await readSpreadsheetML(bytes('<Styles><Style ss:ID="Default"><Font ss:Underline="Double"/><Alignment ss:Horizontal="Right"/><Interior ss:Pattern="Solid"/></Style><Style ss:ID="s"><Font ss:Underline="Bogus"/><Alignment ss:Horizontal="Bogus"/><Interior ss:Pattern="Bogus"/></Style></Styles><Worksheet ss:Name="S"><Table><Row><Cell ss:StyleID="s"><Data>x</Data></Cell></Row></Table></Worksheet>'), c.value);
    expect(book.sheets[0]!.cells[0]!.style).toMatchObject({ Font: { Underline: 2 }, HAlign: 4, Shade: 1 });
    expect(c.diagnostics.map(d => d.message)).toEqual(["Invalid attribute 'Underline', unknown enum value 'Bogus'\n", "Invalid attribute 'Horizontal', unknown enum value 'Bogus'\n", "Invalid attribute 'Pattern', unknown enum value 'Bogus'\n"]);
  });
  it("inherits row styles across Span and patches repeated axis metadata", async () => {
    const book = await readSpreadsheetML(bytes('<Styles><Style ss:ID="s"><Font ss:Bold="1"/><NumberFormat ss:Format="0.00"/></Style></Styles><Worksheet ss:Name="S"><Table><Column ss:Index="1" ss:Width="10" ss:Hidden="1"/><Column ss:Index="1" ss:Width="30" ss:Hidden="0"/><Row ss:Span="3" ss:StyleID="s"><Cell><Data>x</Data></Cell></Row><Row><Cell><Data>y</Data></Cell></Row><Row><Cell><Data>z</Data></Cell></Row></Table></Worksheet>'), context().value);
    expect(book.sheets[0]!.cells.map(c => c.format)).toEqual(["0.00", "0.00", "0.00"]);
    expect(book.sheets[0]!.columns).toEqual([{ index: 0, sizePoints: 30, hidden: true }]);
  });
  it("reports cell attribute warnings in XML order at the native current coordinate", async () => {
    const c = context();
    await readSpreadsheetML(bytes('<Worksheet ss:Name="S"><Table><Row><Cell ss:Formula="bad" ss:Index="3"><Data>x</Data></Cell><Cell ss:Index="5" ss:Formula="bad"><Data>y</Data></Cell></Row></Table></Worksheet>'), c.value);
    expect(c.diagnostics.map(d => d.message)).toEqual(["S!A1 : Invalid formula 'bad' does not begin with '='\n", "S!E1 : Invalid formula 'bad' does not begin with '='\n"]);
  });
  it("warns and preserves inherited colors when parsing fails, accepting native hexadecimal prefixes", async () => {
    const c = context();
    const book = await readSpreadsheetML(bytes('<Styles><Style ss:ID="Default"><Font ss:Color="#112233"/></Style><Style ss:ID="s"><Font ss:Color="red"/><Interior ss:Color="#AABBCCsuffix"/></Style></Styles><Worksheet ss:Name="S"><Table><Row><Cell ss:StyleID="s"><Data>x</Data></Cell></Row></Table></Worksheet>'), c.value);
    expect(book.sheets[0]!.cells[0]!.style).toMatchObject({ Fore: "#112233", Back: "#AABBCC" });
    expect(c.diagnostics.map(d => d.message)).toEqual(["Invalid attribute 'Color', expected color, received 'red'\n"]);
  });
  it("charges repeated Data semantic work independently of unique cell count", async () => {
    const input = bytes(worksheet(Array.from({ length: 11 }, () => '<Data ss:Type="Number">1</Data>').join('')));
    await expect(readSpreadsheetML(input, context({ workbookWork: 10 }).value)).rejects.toMatchObject({ code: "resource-limit" });
  });
  it("exports empty styled axis regions and full neutral font resets without cell allocation", async () => {
    const c = context();
    const book = await readSpreadsheetML(bytes('<Styles><Style ss:ID="bold"><Font ss:Bold="1"/></Style><Style ss:ID="empty"/></Styles><Worksheet ss:Name="S"><Table><Column ss:Span="2" ss:StyleID="bold"/><Row ss:Index="3" ss:Span="2" ss:StyleID="empty"/></Table></Worksheet>'), c.value);
    expect(book.sheets[0]!.cells).toEqual([]);
    const output = new TextDecoder().decode(await writeGnumeric(book, [], c.value));
    expect(output).toContain('startCol="0" startRow="0" endCol="2" endRow="1048575"');
    expect(output).toContain('startCol="0" startRow="2" endCol="16383" endRow="3"');
    expect(output).toContain('Bold="0"');
    expect(output).toContain('Italic="0"');
  });
  it("quotes sheet names that resemble cells when serializing native formulas", async () => {
    const book = await readSpreadsheetML(bytes('<Worksheet ss:Name="A1"><Table><Row><Cell ss:Formula="=&apos;A1&apos;!R1C1"><Data ss:Type="Number">2</Data></Cell></Row></Table></Worksheet>'), context().value);
    expect(book.sheets[0]!.cells[0]!.formula).toBe("='A1'!$A$1");
  });
  it("matches content probes independently of filename and rejects unrelated namespaces", async () => {
    const c = context();
    expect(await probeSpreadsheetML(bytes(""), c.value)).toBe(true);
    expect(await probeSpreadsheetML(new TextEncoder().encode('<Workbook xmlns="http://www.gnumeric.org/v10.dtd"/>'), c.value)).toBe(false);
    expect(await probeSpreadsheetML(new TextEncoder().encode('<Workbook xmlns="http://schemas.microsoft.com/office/excel/2003/xml"/>'), c.value)).toBe(false);
  });
  it("fails malformed XML instead of importing a partial worksheet", async () => {
    await expect(readSpreadsheetML(bytes('<Worksheet ss:Name="S"><Table>'), context().value)).rejects.toMatchObject({ code: "io", message: "E XML document not well formed!" });
  });
  it("enforces input, cell, XML-node and axis allocation budgets", async () => {
    await expect(readSpreadsheetML(bytes(""), context({ inputBytes: 1 }).value)).rejects.toMatchObject({ code: "resource-limit" });
    await expect(readSpreadsheetML(bytes(worksheet('<Data>v</Data>')), context({ cells: 0 }).value)).rejects.toMatchObject({ code: "resource-limit" });
    await expect(readSpreadsheetML(bytes(worksheet('<Data>v</Data>')), context({ workbookNodes: 1 }).value)).rejects.toMatchObject({ code: "resource-limit" });
    await expect(readSpreadsheetML(bytes('<Worksheet ss:Name="S"><Table><Column ss:Span="1000"/></Table></Worksheet>'), context({ workbookNodes: 20 }).value)).rejects.toMatchObject({ code: "resource-limit" });
  });
  it("observes cancellation before probing and after awaited warning delivery", async () => {
    const c = context(); c.controller.abort();
    await expect(probeSpreadsheetML(bytes(""), c.value)).rejects.toBe(c.controller.signal.reason);
    const d = context();
    const value = { ...d.value, async diagnostic() { d.controller.abort(); } };
    const failure = await readSpreadsheetML(bytes('<Unknown/><Worksheet ss:Name="S"/>'), value).catch(error => error);
    expect(failure).toBe(d.controller.signal.reason);
  });
});
