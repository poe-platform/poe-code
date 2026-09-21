import { expect, it, vi } from "vitest";
import { Volume } from "memfs";
import { gzipSync, gunzipSync } from "node:zlib";
import { createEngine } from "../engine.js";
import { recalculateWorkbook } from "../formulas/evaluator.js";
import { readGnumeric, writeGnumeric, writeCompressedGnumeric } from "./gnumeric.js";
import type { CapabilityContext } from "../contracts.js";

const xml = '<?xml version="1.0" encoding="UTF-8"?><g:Workbook xmlns:g="http://www.gnumeric.org/v10.dtd"><g:Calculation ManualRecalc="1" EnableIteration="1" MaxIterations="23" IterationTolerance="0.002" DateConvention="Apple:1904"/><g:SheetNameIndex><g:SheetName g:Cols="256" g:Rows="65536">Résumé</g:SheetName></g:SheetNameIndex><g:Sheets><g:Sheet Visibility="hidden"><g:Name>Résumé</g:Name><g:Zoom>1.25</g:Zoom><g:Cells><g:Cell Row="2" Col="3" ValueType="60">a&amp;b</g:Cell><g:Cell Row="4" Col="1" ValueType="40" Value="3">=1+2</g:Cell></g:Cells><g:MergedRegions><g:Merge>A1:B2</g:Merge></g:MergedRegions></g:Sheet></g:Sheets><g:UIData SelectedTab="0"/></g:Workbook>';
function fixture(bytes: Uint8Array, filename = "/book.gnumeric") {
  const volume = new Volume(); volume.writeFileSync(filename, bytes);
  const engine = createEngine({ codecs: [], environment: { env: {}, locale: "C", timezone: "UTC" },
    limits: { inputBytes: 100000, outputBytes: 100000, cells: 1000, sheets: 3, operations: 1000 },
    filesystem: { async read(uri, signal) { signal.throwIfAborted(); return [new Uint8Array(volume.readFileSync(uri) as Uint8Array)]; },
      async write(uri, bytes, signal) { signal.throwIfAborted(); volume.writeFileSync(uri, bytes); } } });
  return { engine, volume, operation: { signal: new AbortController().signal } };
}
it.each([false, true])("imports sparse Gnumeric XML with gzip=%s through the shared engine", async compressed => {
  const f = fixture(compressed ? gzipSync(xml) : new TextEncoder().encode(xml));
  const book = await f.engine.readWorkbook({ kind: "resource", uri: "/book.gnumeric" }, {}, f.operation);
  expect(book).toMatchObject({ dateSystem: "1904", calculationMode: "manual", iteration: { enabled: true, maximum: 23, tolerance: 0.002 },
    sheets: [{ name: "Résumé", visibility: "hidden", size: { rows: 65536, columns: 256 },
      merges: [{ startRow: 0, startColumn: 0, endRow: 1, endColumn: 1 }],
      cells: [{ row: 2, column: 3, value: { kind: "string", value: "a&b" } },
        { row: 4, column: 1, formula: "=1+2", cachedResult: { kind: "number", value: 3 } }] }] });
  for (const [id, destination] of [["Gnumeric_XmlIO:sax", "/round.gnumeric"], ["Gnumeric_XmlIO:sax:0", "/round.xml"]] as const) {
    const result = await f.engine.writeWorkbook(book, { kind: "resource", uri: destination }, { exportType: id }, f.operation);
    expect(result.exitCode).toBe(0);
  }
  const compressedBytes = f.volume.readFileSync("/round.gnumeric") as Uint8Array;
  expect([...compressedBytes.slice(0, 2)]).toEqual([31, 139]);
  expect(gunzipSync(compressedBytes).toString()).toBe(f.volume.readFileSync("/round.xml", "utf8"));
  const round = await f.engine.readWorkbook({ kind: "resource", uri: "/round.xml" }, {}, f.operation);
  expect(round.sheets[0]!.cells[1]).toMatchObject({ formula: "=1+2", value: { kind: "blank" } });
  expect(round.sheets[0]!.cells[1]!.cachedResult).toBeUndefined();
  // Normal native XML export omits caches; forced recalculation restores data.
  const calculated = recalculateWorkbook(round, { ...f.operation, own() {}, environment: { env: {}, locale: "C", timezone: "UTC" },
    limits: { inputBytes: 100000, outputBytes: 100000, cells: 1000, sheets: 3, operations: 1000 } }, true);
  expect(calculated.sheets[0]!.cells.map(cell => cell.value)).toEqual(book.sheets[0]!.cells.map(cell => cell.value));
  await f.engine.dispose();
});

const context: CapabilityContext = { signal: new AbortController().signal, own() {}, environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 100000, outputBytes: 100000, cells: 1000, sheets: 3, operations: 1000 } };
it("drops ignored core style and margin attributes without losing their declared data", async () => {
  const source = '<g:Workbook xmlns:g="http://www.gnumeric.org/v10.dtd"><g:Sheets><g:Sheet><g:Name>S</g:Name><g:PrintInformation><g:Margins><g:top Points="42" PrefUnit="mm" Mystery="gone"/></g:Margins></g:PrintInformation><g:Styles><g:StyleRegion startCol="0" startRow="0" endCol="0" endRow="0"><g:Style Format="0.00" Orient="3" Mystery="gone" g:Format="bad"><g:Font Unit="12" Bold="1" Mystery="gone">Sans</g:Font></g:Style></g:StyleRegion></g:Styles><g:Cells><g:Cell Row="0" Col="0" ValueType="40">1.2</g:Cell></g:Cells></g:Sheet></g:Sheets></g:Workbook>';
  const f = fixture(new TextEncoder().encode(source));
  try {
    const book = await f.engine.readWorkbook({ kind: "resource", uri: "/book.gnumeric" }, {}, f.operation);
    const result = await f.engine.writeWorkbook(book, { kind: "resource", uri: "/round.xml" }, { exportType: "Gnumeric_XmlIO:sax:0" }, f.operation);
    expect(result.exitCode).toBe(0);
    const output = f.volume.readFileSync("/round.xml", "utf8") as string;
    expect(output).not.toContain('Mystery=');
    expect(output).not.toContain('Orient=');
    expect(output).not.toContain('gnm:Format="bad"');
    expect(output).toContain('<gnm:top Points="42" PrefUnit="mm"/>');
    expect(output).toContain('<gnm:Font Unit="12" Bold="1">Sans</gnm:Font>');
    const round = await f.engine.readWorkbook({ kind: "resource", uri: "/round.xml" }, {}, f.operation);
    expect(round.sheets[0]!.cells[0]).toMatchObject({ format: "0.00", value: { kind: "number", value: 1.2 } });
  } finally { await f.engine.dispose(); }
});
it.each([
  ["top", "CM", "mm"], ["bottom", "centimeter", "mm"], ["left", "in", "inch"],
  ["right", "INCHES", "inch"], ["header", "pt", "points"], ["footer", "unknown", "points"]
])("normalizes %s margin display unit %s to native %s", async (margin, input, expected) => {
  const source = `<g:Workbook xmlns:g="http://www.gnumeric.org/v10.dtd"><g:Sheets><g:Sheet><g:Name>S</g:Name><g:PrintInformation><g:Margins><g:${margin} Points="17" PrefUnit="${input}"/></g:Margins></g:PrintInformation></g:Sheet></g:Sheets></g:Workbook>`;
  const book = await readGnumeric(new TextEncoder().encode(source), context);
  const output = new TextDecoder().decode(await writeGnumeric(book, [], context));
  expect(output).toContain(`<gnm:${margin} Points="17" PrefUnit="${expected}"/>`);
});
it("uses the leaf sheet-name SAX state separately from named-expression names", async () => {
  const messages: string[] = [];
  const source = '<g:Workbook xmlns:g="http://www.gnumeric.org/v10.dtd"><g:Names><g:Name><g:name>Global</g:name><g:value>1</g:value><g:position>A1</g:position></g:Name></g:Names><g:Sheets><g:Sheet><g:Name>S<g:value>bad</g:value></g:Name><g:Names><g:Name><g:name>Local</g:name><g:value>2</g:value><g:position>A1</g:position></g:Name></g:Names></g:Sheet></g:Sheets></g:Workbook>';
  const book = await readGnumeric(new TextEncoder().encode(source), { ...context, async diagnostic(d) { messages.push(d.message); } });
  expect(messages).toEqual(["Unexpected element 'g:value' in state : \n\tWorkbook -> Sheets -> Sheet -> Name\n"]);
  expect(book.sheets[0]!.name).toBe("Sbad");
  expect(book.names?.map(n => [n.name, n.expression])).toEqual([["Global", "1"], ["Local", "2"]]);
});
it("retains delegated graph style properties without treating scalar properties as styles", async () => {
  const messages: string[] = [];
  const source = '<g:Workbook xmlns:g="http://www.gnumeric.org/v10.dtd"><g:Sheets><g:Sheet><g:Name>S</g:Name><g:Objects><g:SheetObjectGraph ObjectBound="A1:B2"><GogObject type="GogGraph"><property name="style" type="GogStyle"><outline width="2" color="FF0000FF"/><fill type="pattern"><pattern type="solid" fore="00FF00FF" back="FFFFFFFF"/></fill></property><property name="name"><outline width="99"/></property></GogObject></g:SheetObjectGraph></g:Objects></g:Sheet></g:Sheets></g:Workbook>';
  const book = await readGnumeric(new TextEncoder().encode(source), { ...context, async diagnostic(d) { messages.push(d.message); } });
  expect(messages).toEqual(["Unexpected element 'outline' in state : \n\tWorkbook -> Sheets -> Sheet -> Objects -> SheetObjectGraph -> GogObject -> property\n"]);
  const output = new TextDecoder().decode(await writeGnumeric(book, [], context));
  expect(output).toContain('<outline width="2" color="FF0000FF"/>');
  expect(output).toContain('<pattern type="solid" fore="00FF00FF" back="FFFFFFFF"/>');
  expect(output).not.toContain('width="99"');
});
it("matches native date-convention attribute namespaces and emits the compatibility element", async () => {
  const source = (calculation: string) => `<g:Workbook xmlns:g="http://www.gnumeric.org/v10.dtd">${calculation}<g:Sheets><g:Sheet><g:Name>Date</g:Name></g:Sheet></g:Sheets></g:Workbook>`;
  const qualified = await readGnumeric(new TextEncoder().encode(source('<g:Calculation g:DateConvention="Apple:1904"/>')), context);
  expect(qualified.dateSystem).toBe("1900");
  const unqualified = await readGnumeric(new TextEncoder().encode(source('<g:Calculation DateConvention="Apple:1904"/>')), context);
  expect(unqualified.dateSystem).toBe("1904");
  const output = await writeGnumeric(unqualified, [], context);
  expect(new TextDecoder().decode(output)).toContain('<gnm:DateConvention>1904</gnm:DateConvention>');
  expect((await readGnumeric(output, context)).dateSystem).toBe("1904");
  const ordered = await readGnumeric(new TextEncoder().encode(source('<g:DateConvention>1904</g:DateConvention><g:Calculation DateConvention="Lotus:1900"/>')), context);
  expect(ordered.dateSystem).toBe("1900");
});
it("orders invalid date-convention diagnostics before descendant SAX warnings", async () => {
  const diagnostics: string[] = [];
  const source = '<g:Workbook xmlns:g="http://www.gnumeric.org/v10.dtd"><g:Calculation DateConvention="invalid"><g:Unexpected/></g:Calculation></g:Workbook>';
  await readGnumeric(new TextEncoder().encode(source), { ...context, diagnostic: async d => { diagnostics.push(d.message); } });
  expect(diagnostics).toEqual(["Ignoring invalid date conventions.\n", "Unexpected element 'g:Unexpected' in state : \n\tWorkbook -> Calculation\n"]);
});
it("reads calculation booleans with native case-insensitive false and nonzero semantics", async () => {
  // gnm_xml_attr_bool compares false case-insensitively and 0 exactly.
  const source = xml.replace('ManualRecalc="1" EnableIteration="1"', 'ManualRecalc="true" EnableIteration="FaLsE"');
  const book = await readGnumeric(new TextEncoder().encode(source), context);
  expect(book.calculationMode).toBe("manual");
  expect(book.iteration?.enabled).toBe(false);
  const zero = await readGnumeric(new TextEncoder().encode(source.replace('ManualRecalc="true"', 'ManualRecalc="0"').replace('EnableIteration="FaLsE"', 'EnableIteration="2"')), context);
  expect(zero.calculationMode).toBe("automatic");
  expect(zero.iteration?.enabled).toBe(true);
});
it("applies repeated calculation callbacks in source order without resetting omitted fields", async () => {
  const source = '<g:Workbook xmlns:g="http://www.gnumeric.org/v10.dtd"><g:Calculation ManualRecalc="true" EnableIteration="0" MaxIterations="7" IterationTolerance="0.2"/><g:Calculation ManualRecalc="false" MaxIterations="10"/></g:Workbook>';
  expect(await readGnumeric(new TextEncoder().encode(source), context)).toMatchObject({ calculationMode: "automatic", iteration: { enabled: false, maximum: 10, tolerance: 0.2 } });
});
it("exposes and preserves GOffice rich text attribute runs alongside the cell style", async () => {
  const source = xml.replace('<g:Cells>', '<g:Styles><g:StyleRegion startCol="0" startRow="0" endCol="255" endRow="65535"><g:Style Format="General"/></g:StyleRegion></g:Styles><g:Cells>')
    .replace('ValueType="60">a&amp;b', 'ValueType="60" ValueFormat="@[bold=1:0:1][italic=1:1:3]">a&amp;b');
  const book = await readGnumeric(new TextEncoder().encode(source), context);
  expect(book.sheets[0]!.cells[0]!.richText).toEqual([{ start: 0, end: 1, attributes: { bold: 1 } }, { start: 1, end: 3, attributes: { italic: 1 } }]);
  const serialized = await writeGnumeric(book, [], context);
  expect(new TextDecoder().decode(serialized)).toContain('ValueFormat="@[bold=1:0:1][italic=1:1:3]"');
  expect((await readGnumeric(serialized, context)).sheets[0]!.cells[0]!.richText).toEqual(book.sheets[0]!.cells[0]!.richText);
});
it("keeps inherited style formats separate from value-owned formats", async () => {
  // Native xml_write_cell uses value_get_fmt, not the covering cell style.
  // ValueFormat on a boolean causes native value_set_fmt to emit a critical.
  const source = xml.replace('<g:Cells>', '<g:Styles><g:StyleRegion startCol="0" startRow="0" endCol="255" endRow="65535"><g:Style Format="General"/></g:StyleRegion></g:Styles><g:Cells>')
    .replace('ValueType="60">a&amp;b', 'ValueType="20">TRUE');
  const book = await readGnumeric(new TextEncoder().encode(source), context);
  expect(book.sheets[0]!.cells[0]!.format).toBe("General");
  const output = new TextDecoder().decode(await writeGnumeric(book, [], context));
  expect(output).toContain('Format="General"');
  expect(output).not.toContain('ValueFormat=');
  expect((await readGnumeric(new TextEncoder().encode(output), context)).sheets[0]!.cells[0]!.value).toEqual({ kind: "boolean", value: true });
});
it("bounds cell/style relationship work before quadratic metadata comparisons", async () => {
  const source = xml.replace('<g:Cells>', '<g:Styles><g:StyleRegion startCol="0" startRow="0" endCol="255" endRow="65535"><g:Style Format="General"/></g:StyleRegion></g:Styles><g:Cells>');
  await expect(readGnumeric(new TextEncoder().encode(source), { ...context, limits: { ...context.limits, workbookWork: 1 } })).rejects.toMatchObject({ code: "resource-limit" });
});
it("bounds expanded axis metadata across the entire workbook", async () => {
  const sheet = (name: string) => `<g:Sheet><g:Name>${name}</g:Name><g:Rows><g:RowInfo No="0" Count="12" Unit="12"/></g:Rows></g:Sheet>`;
  const source = `<g:Workbook xmlns:g="http://www.gnumeric.org/v10.dtd"><g:Sheets>${sheet("First")}${sheet("Second")}</g:Sheets></g:Workbook>`;
  await expect(readGnumeric(new TextEncoder().encode(source), { ...context, limits: { ...context.limits, workbookNodes: 20 } })).rejects.toMatchObject({ code: "resource-limit" });
});
it("uses SheetNameIndex order even when sheet data is serialized in another order", async () => {
  const source = '<gnm:Workbook xmlns:gnm="http://www.gnumeric.org/v10.dtd"><gnm:SheetNameIndex><gnm:SheetName gnm:Cols="128" gnm:Rows="128">First</gnm:SheetName><gnm:SheetName gnm:Cols="256" gnm:Rows="65536">Second</gnm:SheetName></gnm:SheetNameIndex><gnm:Sheets><gnm:Sheet><gnm:Name>Second</gnm:Name><gnm:Cells><gnm:Cell Row="0" Col="0" ValueType="60">second</gnm:Cell></gnm:Cells></gnm:Sheet><gnm:Sheet><gnm:Name>First</gnm:Name><gnm:Names><gnm:Name><gnm:name>Rate</gnm:name><gnm:value>0.25</gnm:value><gnm:position>C3</gnm:position></gnm:Name></gnm:Names></gnm:Sheet></gnm:Sheets><gnm:UIData SelectedTab="1"/></gnm:Workbook>';
  const book = await readGnumeric(new TextEncoder().encode(source), context);
  expect(book.sheets.map(s => s.name)).toEqual(["First", "Second"]);
  expect(book.sheets[0]!.size).toEqual({ rows: 128, columns: 128 });
  expect(book.names).toEqual([{ name: "Rate", expression: "0.25", sheet: "s1", position: { sheet: "s1", row: 2, column: 2 } }]);
  expect(book.activeSheet).toBe("s2");
});
it("retains a one-cell array corner rather than flattening its formula group", async () => {
  // xml_sax_cell treats any positive Rows/Cols pair as an array corner.
  const source = xml.replace('Row="4" Col="1" ValueType="40"', 'Row="4" Col="1" Rows="1" Cols="1" ValueType="40"');
  const book = await readGnumeric(new TextEncoder().encode(source), context);
  expect(book.sheets[0]!.formulaGroups).toEqual([{ id: "array-4-1", kind: "array", range: { startRow: 4, startColumn: 1, endRow: 4, endColumn: 1 }, expression: "=1+2" }]);
  const output = await writeGnumeric(book, [], context);
  expect(new TextDecoder().decode(output)).toContain('<gnm:Cell Row="4" Col="1" Rows="1" Cols="1">=1+2</gnm:Cell>');
  expect((await readGnumeric(output, context)).sheets[0]!.formulaGroups).toEqual(book.sheets[0]!.formulaGroups);
});
it("keeps delegated drawing styles and image payloads instead of dropping valid object children", async () => {
  const source = xml.replace('<g:Cells>', '<g:Objects><g:SheetObjectFilled Type="101" Label="label" ObjectBound="A1:B2"><Style><line width="2" color="FF0000FF"/><fill type="pattern"><pattern type="1" fore="000000FF" back="FFFFFFFF"/></fill></Style></g:SheetObjectFilled><g:SheetObjectImage ObjectBound="C3:D4"><Content image-type="png" size-bytes="3">YWJj</Content></g:SheetObjectImage></g:Objects><g:Cells>');
  const diagnostics: string[] = [];
  const book = await readGnumeric(new TextEncoder().encode(source), { ...context, diagnostic: async d => { diagnostics.push(d.message); } });
  const output = new TextDecoder().decode(await writeGnumeric(book, [], context));
  expect(output).toContain('<line width="2" color="FF0000FF"/>');
  expect(output).toContain('>YWJj</Content>'); expect(diagnostics).toEqual([]);
});
it("admits compressed output by its compressed size independently of XML serialization size", async () => {
  const book = { sheets: [{ id: "s1", name: "Sheet", cells: [{ row: 0, column: 0, value: { kind: "string" as const, value: "x".repeat(4000) } }] }] };
  const bounded = { ...context, limits: { ...context.limits, outputBytes: 1000 } };
  const output = await writeCompressedGnumeric(book, [], bounded);
  expect(output.byteLength).toBeLessThanOrEqual(1000); expect(gunzipSync(output).toString()).toContain("x".repeat(4000));
  await expect(writeGnumeric(book, [], bounded)).rejects.toMatchObject({ code: "resource-limit" });
});
it("writes the reference libgsf UNIX gzip header independently of the JavaScript host", async () => {
  const bytes = await writeCompressedGnumeric({ sheets: [{ id: "s", name: "Sheet", cells: [] }] }, [], context);
  // gsf-output-gzip.c gzip_output_header sets buf[9] = 3, even on other hosts.
  expect([...bytes.subarray(0, 10)]).toEqual([31, 139, 8, 0, 0, 0, 0, 0, 0, 3]);
});
it("registers gzip cleanup before acquiring the compression stream", async () => {
  const events: string[] = [];
  const NativeCompression = globalThis.CompressionStream;
  vi.stubGlobal("CompressionStream", class extends NativeCompression {
    constructor(...args: ConstructorParameters<typeof CompressionStream>) { events.push("acquired"); super(...args); }
  });
  try {
    await writeCompressedGnumeric({ sheets: [{ id: "s", name: "Sheet", cells: [] }] }, [], { ...context, own() { events.push("owned"); } });
    expect(events).toEqual(["owned", "acquired"]);
  } finally { vi.unstubAllGlobals(); }
});
it("closes gzip acquisition admission when registered cleanup runs immediately", async () => {
  let acquired = false;
  const NativeCompression = globalThis.CompressionStream;
  vi.stubGlobal("CompressionStream", class extends NativeCompression {
    constructor(...args: ConstructorParameters<typeof CompressionStream>) { acquired = true; super(...args); }
  });
  try {
    await expect(writeCompressedGnumeric({ sheets: [{ id: "s", name: "Sheet", cells: [] }] }, [], { ...context, own(cleanup) { void cleanup(); } })).rejects.toMatchObject({ code: "io" });
    expect(acquired).toBe(false);
  } finally { vi.unstubAllGlobals(); }
});
it("writes native 17-significant-digit numbers including ties-to-even, scientific thresholds and negative zero", async () => {
  const values = [0.1, 1e-5, 2 ** -25, 1e16, 1e17, -0];
  const book = { sheets: [{ id: "s1", name: "Sheet", cells: values.map((n, row) => ({ row, column: 0, value: { kind: "number" as const, value: n } })) }] };
  const output = new TextDecoder().decode(await writeGnumeric(book, [], context));
  for (const [row, text] of ["0.10000000000000001", "1.0000000000000001e-05", "2.9802322387695312e-08", "10000000000000000", "1e+17", "0"].entries()) {
    expect(output).toContain(`<gnm:Cell Row="${row}" Col="0" ValueType="40">${text}</gnm:Cell>`);
  }
});
it("uses native field precision for zoom and iteration tolerance", async () => {
  const source = xml.replace('<g:Zoom>1.25</g:Zoom>', '<g:Zoom>0.123456</g:Zoom>').replace('IterationTolerance="0.002"', 'IterationTolerance="0.1"');
  const book = await readGnumeric(new TextEncoder().encode(source), context);
  const output = new TextDecoder().decode(await writeGnumeric(book, [], context));
  expect(output).toContain('IterationTolerance="0.1"');
  expect(output).toContain('<gnm:Zoom>0.1235</gnm:Zoom>');
  expect((await readGnumeric(new TextEncoder().encode(output), context)).sheets[0]!.view?.zoom).toBe(0.1235);
});
it("exposes standard/custom workbook metadata and serializes SDK edits with native types", async () => {
  const source = xml.replace('<g:Sheets>', '<office:document-meta xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:meta="urn:oasis:names:tc:opendocument:xmlns:meta:1.0"><office:meta><dc:title>Original</dc:title><meta:keyword>one</meta:keyword><meta:keyword>two</meta:keyword><meta:user-defined meta:name="Count" meta:value-type="float">2.5</meta:user-defined><meta:user-defined meta:name="Enabled" meta:value-type="boolean">true</meta:user-defined></office:meta></office:document-meta><g:Sheets>');
  const book = await readGnumeric(new TextEncoder().encode(source), context);
  expect(book.properties).toEqual({ "dc:title": "Original", "dc:keywords": ["one", "two"], Count: 2.5, Enabled: true });
  const changed = { ...book, properties: { ...book.properties, "dc:title": "Changed Ω", Count: 3.5, Enabled: false } };
  const round = await readGnumeric(await writeGnumeric(changed, [], context), context);
  expect(round.properties).toEqual(changed.properties);
});
it("uses XML A1 formula conventions even when the sheet display convention is R1C1", async () => {
  const source = xml.replace('<g:Sheet Visibility="hidden">', '<g:Sheet Visibility="hidden" ExprConvention="gnumeric:R1C1">').replace('=1+2', '=RC+1');
  const book = await readGnumeric(new TextEncoder().encode(source), context);
  expect(book.sheets[0]!.cells[1]!.formula).toBe("=RC+1");
  const output = new TextDecoder().decode(await writeGnumeric(book, [], context));
  expect(output).toContain('ExprConvention="gnumeric:R1C1"'); expect(output).toContain('>=RC+1</gnm:Cell>');
});
