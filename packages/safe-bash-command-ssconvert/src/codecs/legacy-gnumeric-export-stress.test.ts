import { expect, it } from "vitest";
import type { CapabilityContext } from "../contracts.js";
import type { ImportedValue, UnsupportedRecord, Workbook } from "../workbook.js";
import { readGnumeric, writeGnumeric } from "./gnumeric.js";

const context: CapabilityContext = { signal: new AbortController().signal, own() {},
  environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 100000, outputBytes: 100000, cells: 1000, sheets: 4, operations: 10000 } };
const record = (kind: string, data: ImportedValue): UnsupportedRecord => ({ source: "original-test", kind, disposition: "retained", data });
const book = (records: readonly UnsupportedRecord[] = []): Workbook => ({ sheets: [{ id: "s", name: "Sheet", size: { rows: 65536, columns: 256 }, cells: [], unsupportedRecords: records }] });
const output = async (value: Workbook) => new TextDecoder().decode(await writeGnumeric(value, [], context));

it.each([[1, "GENERAL"], [2, "LEFT"], [4, "RIGHT"], [8, "CENTER"]])("neutral legacy horizontal alignment %i writes the native enum name", async (alignment, name) => {
  const value = book([record("StyleRange", { startRow: 0, startColumn: 0, endRow: 0, endColumn: 0, style: { HAlign: alignment } })]);
  expect(await output(value)).toContain(`HAlign="GNM_HALIGN_${name}"`);
});

it("neutral styles emit font faces, point sizes and native 16-bit colors", async () => {
  const xml = await output(book([record("StyleRange", { startRow: 3, startColumn: 2, endRow: 4, endColumn: 5,
    style: { fontName: "A & B", fontSize: 12.5, bold: true, italic: false, underline: true, strike: false,
      fontColor: "#1234ab", backgroundColor: "#FFFFFF", patternColor: "#000000", pattern: 1 } })]));
  expect(xml).toContain('Fore="1212:3434:ABAB" Back="FFFF:FFFF:FFFF" PatternColor="0:0:0"');
  expect(xml).toContain('            <gnm:Font Unit="12.5" Bold="1" Italic="0" Underline="1" StrikeThrough="0">A &amp; B</gnm:Font>');
  expect(xml).not.toContain('<gnm:Cell ');
});

it("neutral default reset precedes subsequent format and font overlays", async () => {
  const range = { startRow: 0, startColumn: 0, endRow: 0, endColumn: 0 };
  const xml = await output(book([record("StyleRange", { ...range, reset: true, format: "General" }),
    record("FormatRange", { ...range, format: "0.00%", style: { bold: true } })]));
  const reset = xml.indexOf('HAlign="GNM_HALIGN_GENERAL"');
  const overlay = xml.indexOf('Format="0.00%"');
  expect(reset).toBeGreaterThan(0); expect(overlay).toBeGreaterThan(reset);
  expect(xml).toContain('<gnm:Font Unit="10" Bold="0" Italic="0" Underline="0" StrikeThrough="0">Sans</gnm:Font>');
  expect(xml).toContain('<gnm:Font Bold="1"/>');
});

it.each([
  { startRow: -1, startColumn: 0, endRow: 0, endColumn: 0 },
  { startRow: 0, startColumn: 0.5, endRow: 0, endColumn: 1 },
  { startRow: 2, startColumn: 0, endRow: 1, endColumn: 0 },
])("neutral style ranges reject invalid coordinates (%#)", async range => {
  await expect(output(book([record("FormatRange", { ...range, format: "0" })]))).rejects.toThrow("invalid style range");
});

it("neutral comment attribute values cannot introduce XML elements or namespaces", async () => {
  const xml = await output(book([record("CellComment", { ObjectBound: "A1", Text: 'x"/><alien:fake xmlns:alien="urn:bad"/>\n&' })]));
  expect(xml).toContain('Text="x&quot;/&gt;&lt;alien:fake xmlns:alien=&quot;urn:bad&quot;/&gt;&#10;&amp;"');
  expect(xml).not.toContain('<alien:fake');
  expect(xml).toContain('xmlns:gnm="http://www.gnumeric.org/v10.dtd"');
});

it("legacy export retains existing Gnumeric XML styles and delegated namespaces", async () => {
  const source = '<g:Workbook xmlns:g="http://www.gnumeric.org/v10.dtd"><g:Sheets><g:Sheet><g:Name>S</g:Name><g:Styles><g:StyleRegion startCol="0" startRow="0" endCol="0" endRow="0"><g:Style Format="0.000"><g:Font Bold="1">Serif</g:Font></g:Style></g:StyleRegion></g:Styles><g:Objects><g:CellComment Text="old"/></g:Objects><g:Cells/></g:Sheet></g:Sheets><GODoc><foreign:extra xmlns:foreign="urn:old" flag="yes"/></GODoc></g:Workbook>';
  const value = await readGnumeric(new TextEncoder().encode(source), context);
  const xml = await output(value);
  expect(xml).toContain('Format="0.000"'); expect(xml).toContain('<gnm:Font Bold="1">Serif</gnm:Font>');
  expect(xml).toContain('Text="old"'); expect(xml).toContain('xmlns:ns0="urn:old" flag="yes"');
});

it("neutral annotations respect XML output and serialization work budgets", async () => {
  const value = book([record("CellComment", { ObjectBound: "A1", Text: "x".repeat(1000) })]);
  await expect(writeGnumeric(value, [], { ...context, limits: { ...context.limits, outputBytes: 800 } })).rejects.toMatchObject({ code: "resource-limit" });
  await expect(writeGnumeric(value, [], { ...context, limits: { ...context.limits, workbookWork: 8 } })).rejects.toMatchObject({ code: "resource-limit" });
});

it("neutral annotations check injected cancellation while serializing", async () => {
  const controller = new AbortController(), reason = new Error("stop annotation serialization"); let checks = 0;
  const signal = { throwIfAborted() {
    if (++checks === 12) controller.abort(reason);
    controller.signal.throwIfAborted();
  } } as AbortSignal;
  await expect(writeGnumeric(book([record("CellComment", { ObjectBound: "A1", Text: "test" })]), [], { ...context, signal })).rejects.toBe(reason);
  expect(checks).toBe(12);
});
