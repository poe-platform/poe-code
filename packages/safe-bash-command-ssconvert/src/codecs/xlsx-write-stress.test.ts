import { expect, it } from "vitest";
import type { CapabilityContext } from "../contracts.js";
import { createXlsxXml, escapeXlsx, metadataNode, writeRichString } from "./xlsx-write-support.js";
import { createXlsxWriter, readXlsx } from "./xlsx.js";
import type { Workbook } from "../workbook.js";
import { createZipCodec } from "@poe-code/office-package";

const context: CapabilityContext = { signal: new AbortController().signal, own() {},
  environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 100000, outputBytes: 100000, cells: 100, sheets: 3, operations: 100 } };

it.each(["a/><injected", "a bad", "a:b:c", "1name", ""])("rejects unsafe metadata element name %j", name => {
  expect(() => createXlsxXml(context).element(name)).toThrowError(/XML.*name/);
});
it.each(["a\" injected=\"yes", "a bad", "a:b:c", "1name", ""])("rejects unsafe metadata attribute name %j", name => {
  expect(() => createXlsxXml(context).element("autoFilter", { [name]: "x" })).toThrowError(/XML.*name/);
});
it("admits valid qualified and Unicode names and preserves XML attribute whitespace", () => {
  expect(createXlsxXml(context).element("gnmx:é", { "xml:space": "preserve", x: "\t\r\n&<>\"" }))
    .toBe('<gnmx:é xml:space="preserve" x="&#9;&#13;&#10;&amp;&lt;&gt;&quot;"/>');
});
it("charges attribute text against the writer work budget", () => {
  const xml = createXlsxXml({ ...context, limits: { ...context.limits, workbookWork: 10 } });
  expect(() => xml.element("t", { val: "x".repeat(11) })).toThrowError(/work limit/);
});
it("maps the unsupported Pango error underline to the native single underline", () => {
  expect(writeRichString("x", [{ start: 0, end: 1, attributes: { underline: "error" } }], createXlsxXml(context).element))
    .toContain('<u val="single"/>');
});
it("observes the exact cancellation reason before XML work", () => {
  const abort = new AbortController(), reason = { cancelled: true }; abort.abort(reason);
  try { createXlsxXml({ ...context, signal: abort.signal }).element("t"); throw new Error("accepted cancellation"); }
  catch (error) { expect(error).toBe(reason); }
});
it("bounds UTF-8 output bytes and rejects non-XML scalar values", () => {
  expect(() => createXlsxXml({ ...context, limits: { ...context.limits, outputBytes: 10 } }).element("t", {}, "😀"))
    .toThrowError(/output bytes/);
  for (const value of ["\0", "\uffff", "\ud800"]) expect(() => escapeXlsx(value)).toThrowError(/non-XML/);
  expect(escapeXlsx("😀\t\n\r")).toBe("😀\t\n&#13;");
});
it("preserves complete multibyte rich text segments and overlapping formatting", () => {
  const output = writeRichString("a😀b", [
    { start: 0, end: 6, attributes: { bold: 1 } },
    { start: 1, end: 5, attributes: { italic: 1 } }
  ], createXlsxXml(context).element);
  expect(output).toBe('<r><rPr><b val="1"/></rPr><t>a</t></r><r><rPr><b val="1"/><i val="1"/></rPr><t>😀</t></r><r><rPr><b val="1"/></rPr><t>b</t></r>');
});
it("admits the rich-text comparison work before scanning every run", () => {
  const xml = createXlsxXml({ ...context, limits: { ...context.limits, workbookWork: 30 } });
  const runs = Array.from({ length: 10 }, (_, i) => ({ start: i, end: i + 1, attributes: { bold: 1 } }));
  expect(() => writeRichString("0123456789", runs, createXlsxXml(context).element, xml.charge)).toThrowError(/work limit/);
});
it("rejects cyclic retained metadata without overflowing the JavaScript stack", () => {
  const data: { name: string; children: unknown[] } = { name: "Style", children: [] }; data.children.push(data);
  expect(() => metadataNode(data as never)).toThrowError(/cyclic XLSX metadata/);
});
it("accepts deep retained metadata while preserving traversal work limits", () => {
  let data: { name: string; children: unknown[] } = { name: "Style", children: [] };
  for (let i = 0; i < 130; i++) data = { name: "Style", children: [data] };
  expect(metadataNode(data as never)?.name).toBe("Style");
  const xml = createXlsxXml({ ...context, limits: { ...context.limits, workbookWork: 1 } });
  expect(() => metadataNode({ name: "Style", attributes: { x: "long" }, children: [] }, xml.charge))
    .toThrowError(/work limit/);
});

const book: Workbook = { sheets: [{ id: "s", name: "S", cells: [{ row: 0, column: 0, value: { kind: "number", value: 1 } }] }] };
it.each(["2006", "2008"] as const)("%s rejects unsafe raw filter metadata before an archive is returned", async edition => {
  const input: Workbook = { sheets: [{ ...book.sheets[0]!, unsupportedRecords: [{ source: "Gnumeric_Excel:xlsx",
    kind: "autoFilter", disposition: "retained", data: { name: "autoFilter/><injected", namespace: "http://schemas.openxmlformats.org/spreadsheetml/2006/main",
      attributes: {}, text: "", children: [] } }] }] };
  await expect(createXlsxWriter(edition)(input, [], context)).rejects.toMatchObject({ code: "invalid-request" });
});
it.each(["2006", "2008"] as const)("%s rejects node exhaustion and oversized cells", async edition => {
  await expect(createXlsxWriter(edition)(book, [], { ...context, limits: { ...context.limits, workbookNodes: 1 } }))
    .rejects.toMatchObject({ code: "resource-limit" });
  const oversized: Workbook = { sheets: [{ ...book.sheets[0]!, size: { rows: 2097152, columns: 256 },
    cells: [{ row: 1048576, column: 0, value: { kind: "number", value: 1 } }] }] };
  await expect(createXlsxWriter(edition)(oversized, [], context)).rejects.toMatchObject({ code: "unsupported-feature" });
  const negative: Workbook = { sheets: [{ ...book.sheets[0]!, cells: [{ row: -1, column: 0, value: { kind: "number", value: 1 } }] }] };
  await expect(createXlsxWriter(edition)(negative, [], context)).rejects.toMatchObject({ code: "unsupported-feature" });
});
it.each(["2006", "2008"] as const)("%s observes cancellation during awaited loss diagnostics", async edition => {
  const abort = new AbortController(), reason = { cancelledDuringDiagnostic: true };
  const warnings: string[] = [];
  const input: Workbook = { ...book, unsupportedRecords: [{ source: "fixture", kind: "unknown", disposition: "retained", data: {} }] };
  await expect(createXlsxWriter(edition)(input, [], { ...context, signal: abort.signal,
    async diagnostic(value) { warnings.push(value.message); abort.abort(reason); } })).rejects.toBe(reason);
  expect(warnings).toEqual(["XLSX writer does not export workbook record 'unknown'"]);
});
it.each(["2006", "2008"] as const)("%s rejects merges beyond the XLSX writer row limit", async edition => {
  const oversized: Workbook = { sheets: [{ ...book.sheets[0]!, size: { rows: 2097152, columns: 256 },
    merges: [{ startRow: 1048576, endRow: 1048577, startColumn: 0, endColumn: 1 }] }] };
  await expect(createXlsxWriter(edition)(oversized, [], context)).rejects.toMatchObject({ code: "unsupported-feature" });
});
it.each(["autoFilter", "dataValidations"])("rejects retained %s with a relationship ID without its target", async kind => {
  const input: Workbook = { sheets: [{ ...book.sheets[0]!, unsupportedRecords: [{ source: "Gnumeric_Excel:xlsx",
    kind, disposition: "retained", data: { name: kind, namespace: "http://schemas.openxmlformats.org/spreadsheetml/2006/main",
      attributes: { "r:id": "missing" }, text: "", children: [] } }] }] };
  await expect(createXlsxWriter("2008")(input, [], context)).rejects.toMatchObject({ code: "unsupported-feature" });
});
it.each(["autoFilter", "dataValidations"])("rejects retained %s descendants with a foreign namespace", async kind => {
  const input: Workbook = { sheets: [{ ...book.sheets[0]!, unsupportedRecords: [{ source: "Gnumeric_Excel:xlsx",
    kind, disposition: "retained", data: { name: kind, namespace: "http://schemas.openxmlformats.org/spreadsheetml/2006/main",
      attributes: {}, text: "", children: [{ name: "extension", namespace: "urn:foreign", attributes: {}, text: "", children: [] }] } }] }] };
  await expect(createXlsxWriter("2008")(input, [], context)).rejects.toMatchObject({ code: "unsupported-feature" });
});
it.each(["autoFilter", "dataValidations"])("rejects retained %s default namespace overrides", async kind => {
  const input: Workbook = { sheets: [{ ...book.sheets[0]!, unsupportedRecords: [{ source: "Gnumeric_Excel:xlsx", kind, disposition: "retained",
    data: { name: kind, namespace: "http://schemas.openxmlformats.org/spreadsheetml/2006/main", attributes: { xmlns: "urn:foreign" }, children: [] } }] }] };
  await expect(createXlsxWriter("2008")(input, [], context)).rejects.toMatchObject({ code: "unsupported-feature" });
});
it("preserves a retained full-sheet style on column defaults instead of silently dropping it", async () => {
  const input: Workbook = { sheets: [{ id: "s", name: "S", cells: [], unsupportedRecords: [{ source: "Gnumeric_XmlIO:sax",
    kind: "Styles", disposition: "retained", data: { name: "Styles", namespace: "http://www.gnumeric.org/v10.dtd", children: [
      { name: "StyleRegion", namespace: "http://www.gnumeric.org/v10.dtd", attributes: { startRow: "0", endRow: "65535", startCol: "0", endCol: "255" },
        children: [{ name: "Style", namespace: "http://www.gnumeric.org/v10.dtd", attributes: { Format: "0.000" }, children: [] }] }
    ] } }] }] };
  const bytes = await createXlsxWriter("2008")(input, [], context);
  const zip = createZipCodec(), limits = { maxArchiveBytes: 100000, maxEntryBytes: 100000, maxTotalBytes: 100000,
    maxMembers: 100, maxPathBytes: 1024, maxDepth: 32, maxPaxBytes: 10000, maxTextBytes: 100000, chunkSize: 4096 };
  const archive = await zip.readZipArchive(bytes, limits, context.signal);
  const parts = new Map<string, string>();
  for (const entry of archive.entries) {
    const decoder = new TextDecoder(); let text = "";
    for await (const bytes of zip.decodeZipEntry(entry, limits, context.signal)) text += decoder.decode(bytes, { stream: true });
    parts.set(entry.name, text + decoder.decode());
  }
  expect(parts.get("xl/styles.xml")).toContain('formatCode="0.000"');
  expect(parts.get("xl/worksheets/sheet1.xml")).toContain('min="1" max="256" style="1"');
});
it("awaits loss diagnostics in sheet-before-workbook source order", async () => {
  const input: Workbook = { ...book, unsupportedRecords: [
    { source: "fixture", kind: "first", disposition: "retained" }, { source: "fixture", kind: "second", disposition: "retained" }
  ], sheets: [{ ...book.sheets[0]!, unsupportedRecords: [
    { source: "fixture", kind: "image", disposition: "retained" }, { source: "fixture", kind: "chart", disposition: "retained" }
  ] }] };
  const warnings: string[] = [];
  await createXlsxWriter("2008")(input, [], { ...context, async diagnostic(value) {
    await Promise.resolve(); warnings.push(value.message);
  } });
  expect(warnings).toEqual(["XLSX writer does not export sheet 'S' record 'image'", "XLSX writer does not export sheet 'S' record 'chart'",
    "XLSX writer does not export workbook record 'first'", "XLSX writer does not export workbook record 'second'"]);
});
it("fills a missing cache while preserving dirty and dependent existing caches and manual mode", async () => {
  const input: Workbook = { calculationMode: "manual", sheets: [{ id: "s", name: "S", cells: [
    { row: 0, column: 0, formula: "=1", formulaDirty: true, value: { kind: "number", value: 99 }, cachedResult: { kind: "number", value: 99 } },
    { row: 0, column: 1, formula: "=1+2", value: { kind: "blank" } },
    { row: 0, column: 2, formula: "=A1+B1", formulaDirty: false, value: { kind: "number", value: 777 }, cachedResult: { kind: "number", value: 777 } }
  ] }] };
  const reopened = await readXlsx(await createXlsxWriter("2008")(input, [], context), context);
  expect(reopened.calculationMode).toBe("manual");
  expect(reopened.sheets[0]!.cells.map(cell => cell.cachedResult)).toEqual([
    { kind: "number", value: 99 }, { kind: "number", value: 3 }, { kind: "number", value: 777 }
  ]);
  expect(input.sheets[0]!.cells[1]!.value).toEqual({ kind: "blank" });
});
it("does not invoke external capability for a cached dirty formula while filling an unrelated missing cache", async () => {
  const input: Workbook = { calculationMode: "manual", sheets: [{ id: "s", name: "S", cells: [
    { row: 0, column: 0, formula: "='[authorized.xls]Sheet1'!A1", formulaDirty: true,
      value: { kind: "number", value: 30 }, cachedResult: { kind: "number", value: 30 } },
    { row: 0, column: 1, formula: "=2+3", value: { kind: "blank" } }
  ] }] };
  let calls = 0;
  await createXlsxWriter("2008")(input, [], { ...context, externalReferences: { resolve() { calls++; return { kind: "number", value: 500 }; } } });
  expect(calls).toBe(0);
});
it("admits the total cell bound before reading/copying cells for missing-cache calculation", async () => {
  const input: Workbook = { sheets: [{ id: "s", name: "S", cells: [
    { row: 0, column: 0, value: { kind: "number", value: 1 }, get formula(): string { throw new Error("cell read before admission"); } },
    { row: 0, column: 1, value: { kind: "number", value: 2 } }
  ] }] };
  await expect(createXlsxWriter("2008")(input, [], { ...context, limits: { ...context.limits, cells: 1 } }))
    .rejects.toMatchObject({ code: "resource-limit" });
});
it("admits the sheet bound before reading sheet cell arrays", async () => {
  const input: Workbook = { sheets: [
    { id: "s", name: "S", get cells(): never { throw new Error("sheet read before admission"); } },
    { id: "t", name: "T", cells: [] }
  ] };
  await expect(createXlsxWriter("2008")(input, [], { ...context, limits: { ...context.limits, sheets: 1 } }))
    .rejects.toMatchObject({ code: "resource-limit" });
});
it("does not serialize inherited mappings for prototype-named validation types and operators", async () => {
  const ns = "http://www.gnumeric.org/v10.dtd";
  const input: Workbook = { sheets: [{ id: "s", name: "S", cells: [], unsupportedRecords: [{ source: "Gnumeric_XmlIO:sax", kind: "Styles", disposition: "retained", data: {
    name: "Styles", namespace: ns, children: [{ name: "StyleRegion", namespace: ns, attributes: { startRow: "0", endRow: "0", startCol: "0", endCol: "0" }, children: [
      { name: "Style", namespace: ns, attributes: {}, children: [{ name: "Validation", namespace: ns,
        attributes: { Type: "GNM_VALIDATION_TYPE_constructor", Operator: "GNM_VALIDATION_OP_toString" }, children: [] }] }
    ] }] }
  }] }] };
  const bytes = await createXlsxWriter("2008")(input, [], context), zip = createZipCodec();
  const limits = { maxArchiveBytes: 100000, maxEntryBytes: 100000, maxTotalBytes: 100000, maxMembers: 100,
    maxPathBytes: 1024, maxDepth: 32, maxPaxBytes: 10000, maxTextBytes: 100000, chunkSize: 4096 };
  const archive = await zip.readZipArchive(bytes, limits, context.signal), entry = archive.entries.find(e => e.name === "xl/worksheets/sheet1.xml")!;
  let text = ""; const decoder = new TextDecoder();
  for await (const bytes of zip.decodeZipEntry(entry, limits, context.signal)) text += decoder.decode(bytes, { stream: true });
  text += decoder.decode();
  expect(text).not.toContain("function ");
  expect(text).not.toContain("[native code]");
});
