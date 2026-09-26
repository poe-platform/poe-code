import { expect, it, vi } from "vitest";
import { gzipSync, gunzipSync } from "node:zlib";
import { readGnumeric, writeCompressedGnumeric, writeGnumeric } from "./gnumeric.js";
import type { CapabilityContext } from "../contracts.js";
import type { ImportedValue } from "../workbook.js";

const ns = "http://www.gnumeric.org/v10.dtd";
function xml(content: string): Uint8Array {
  return new TextEncoder().encode(`<g:Workbook xmlns:g="${ns}"><g:Sheets><g:Sheet><g:Name>First</g:Name>${content}</g:Sheet></g:Sheets></g:Workbook>`);
}
function context(limits: Partial<CapabilityContext["limits"]> = {}): CapabilityContext {
  return { signal: new AbortController().signal, own() {}, environment: { env: {}, locale: "C", timezone: "UTC" },
    limits: { inputBytes: 100000, outputBytes: 100000, cells: 100, sheets: 10, operations: 1000, ...limits } };
}
function semantic(value: ImportedValue): ImportedValue {
  if (Array.isArray(value)) return value.map(semantic);
  if (value !== null && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, next]) =>
    [key, key === "text" && typeof next === "string" && !next.trim() ? "" : semantic(next)]));
  return value;
}

it("rebases relative shared expressions while preserving absolute references", async () => {
  const book = await readGnumeric(xml('<g:Cells><g:Cell Row="0" Col="2" ExprID="1">=A1+$B$1</g:Cell><g:Cell Row="1" Col="2" ExprID="1"/></g:Cells>'), context());
  expect(book.sheets[0]!.cells.map(cell => cell.formula)).toEqual(["=A1+$B$1", "=A2+$B$1"]);
});

it("bounds inflation independently of compressed input length", async () => {
  const bytes = gzipSync(xml(`<g:Cells><g:Cell Row="0" Col="0" ValueType="60">${"x".repeat(5000)}</g:Cell></g:Cells>`));
  expect(bytes.byteLength).toBeLessThan(1024);
  await expect(readGnumeric(bytes, context({ inputBytes: 1024 }))).rejects.toMatchObject({ code: "resource-limit" });
});

it("rejects external entities before workbook parsing", async () => {
  const bytes = new TextEncoder().encode(`<!DOCTYPE g:Workbook [<!ENTITY secret SYSTEM "file:///private/secret">]><g:Workbook xmlns:g="${ns}"><g:Sheets/></g:Workbook>`);
  await expect(readGnumeric(bytes, context())).rejects.toMatchObject({ code: "capability-denied", message: "ssconvert host denies XML DTD and entity declarations" });
});

it("keeps foreign namespaced cells out of the workbook", async () => {
  const book = await readGnumeric(xml('<g:Cells xmlns:f="urn:foreign"><f:Cell Row="0" Col="0" ValueType="60">hidden</f:Cell><g:Cell Row="1" Col="0" ValueType="60">visible</g:Cell></g:Cells>'), context());
  expect(book.sheets[0]!.cells.map(cell => cell.value)).toEqual([{ kind: "string", value: "visible" }]);
});

it("keeps print, conditional styles, solver and object records independently of sparse cells", async () => {
  const bytes = xml('<g:PrintInformation><g:Header Left="left" Middle="&amp;[PAGE]" Right="right"/><g:Margins><g:left Points="12" PrefUnit="pt"/></g:Margins></g:PrintInformation><g:Styles><g:StyleRegion startRow="0" startCol="0" endRow="3" endCol="3"><g:Style Format="0.00"><g:Font Bold="1" Italic="1">Sans</g:Font><g:Condition Operator="0"><g:Expression0>A1&gt;0</g:Expression0><g:Style Back="FFFF:0000:0000"/></g:Condition></g:Style></g:StyleRegion></g:Styles><g:Solver TargetCol="0" TargetRow="0"><g:Constr Type="1" lhs="A1" rhs="5"/></g:Solver><g:Objects><g:CellComment Author="Someone" Text="hello"><custom:extra xmlns:custom="urn:object-extension" flag="yes"/></g:CellComment></g:Objects><g:Cells><g:Cell Row="2" Col="2" ValueType="60">é &amp; Ω</g:Cell></g:Cells>');
  const first = await readGnumeric(bytes, context());
  const second = await readGnumeric(await writeGnumeric(first, [], context()), context());
  for (const record of first.sheets[0]!.unsupportedRecords!) {
    const round = second.sheets[0]!.unsupportedRecords!.find(item => item.kind === record.kind);
    expect(semantic(round!.data!)).toEqual(semantic(record.data!));
  }
  expect(second.sheets[0]!.cells[0]!.value).toEqual(first.sheets[0]!.cells[0]!.value);
  expect(semantic(second.sheets[0]!.cells[0]!.style!.gnumeric!)).toEqual(semantic(first.sheets[0]!.cells[0]!.style!.gnumeric!));
});

it("serializes XML deterministically independently of gzip headers", async () => {
  const book = await readGnumeric(xml('<g:Cells><g:Cell Row="3" Col="1" ValueType="60">Ω</g:Cell><g:Cell Row="0" Col="0" ValueType="40">1</g:Cell></g:Cells>'), context());
  const plain = await writeGnumeric(book, [], context());
  expect(await writeGnumeric(book, [], context())).toEqual(plain);
  const compressed = await writeCompressedGnumeric(book, [], context());
  expect(new Uint8Array(gunzipSync(compressed))).toEqual(plain);
  expect(await writeCompressedGnumeric(book, [], context())).toEqual(compressed);
});

it("observes cancellation before inspecting or serializing bytes", async () => {
  const signal = AbortSignal.abort(new Error("cancelled"));
  const ctx = { ...context(), signal };
  await expect(readGnumeric(xml(""), ctx)).rejects.toBe(signal.reason);
  await expect(writeGnumeric({ sheets: [] }, [], ctx)).rejects.toBe(signal.reason);
});

it("exports SDK number-format updates over retained source styles", async () => {
  const book = await readGnumeric(xml('<g:Styles><g:StyleRegion startRow="0" startCol="0" endRow="0" endCol="0"><g:Style Format="0.00"/></g:StyleRegion></g:Styles><g:Cells><g:Cell Row="0" Col="0" ValueType="40">1</g:Cell></g:Cells>'), context());
  const sheet = book.sheets[0]!;
  const changed = { ...book, sheets: [{ ...sheet, cells: [{ ...sheet.cells[0]!, format: "0.0000" }] }] };
  const round = await readGnumeric(await writeGnumeric(changed, [], context()), context());
  expect(round.sheets[0]!.cells[0]!.format).toBe("0.0000");
});

it("exports SDK axis updates over retained source rows", async () => {
  const book = await readGnumeric(xml('<g:Rows><g:RowInfo No="2" Unit="12" Count="1"/></g:Rows>'), context());
  const sheet = book.sheets[0]!;
  const changed = { ...book, sheets: [{ ...sheet, rows: [{ ...sheet.rows![0]!, sizePoints: 24, hidden: true }] }] };
  const round = await readGnumeric(await writeGnumeric(changed, [], context()), context());
  expect(round.sheets[0]!.rows![0]).toMatchObject({ index: 2, sizePoints: 24, hidden: true });
});

it.each(["name", "attribute"])("rejects injected XML %s syntax in SDK imported records", async field => {
  const badName = 'Style bogus="yes"';
  const record = { name: field === "name" ? badName : "Style", namespace: ns, text: "", children: [],
    attributes: field === "attribute" ? [{ name: badName, namespace: "", value: "bad" }] : [] };
  const book = { sheets: [{ id: "s1", name: "First", cells: [{ row: 0, column: 0, value: { kind: "number", value: 1 } as const, style: { gnumeric: record } }] }] };
  await expect(writeGnumeric(book, [], context())).rejects.toMatchObject({ code: "io" });
});

it("observes cancellation during cooperative XML parsing", async () => {
  const controller = new AbortController();
  const bytes = xml(`<g:Cells><g:Cell Row="0" Col="0" ValueType="60">${"x".repeat(40000)}</g:Cell></g:Cells>`);
  const pending = readGnumeric(bytes, { ...context(), signal: controller.signal });
  controller.abort(new Error("during parse"));
  await expect(pending).rejects.toBe(controller.signal.reason);
});

it("decodes declared ISO-8859-1 XML as the pinned native reader does", async () => {
  const source = '<?xml version="1.0" encoding="ISO-8859-1"?>' + new TextDecoder().decode(xml('<g:Cells><g:Cell Row="0" Col="0" ValueType="60">café</g:Cell></g:Cells>'));
  const bytes = Uint8Array.from(source, character => character.charCodeAt(0));
  const book = await readGnumeric(bytes, context());
  expect(book.sheets[0]!.cells[0]!.value).toEqual({ kind: "string", value: "café" });
});

it("drops unknown object descendants with the measured native warning", async () => {
  const diagnostics: string[] = [];
  const ctx = { ...context(), diagnostic: async (diagnostic: { message: string }) => { diagnostics.push(diagnostic.message); } };
  const book = await readGnumeric(xml('<g:Objects><g:CellComment Author="Someone" Text="hello"><custom:extra xmlns:custom="urn:object-extension" flag="yes"/></g:CellComment></g:Objects>'), ctx);
  const output = new TextDecoder().decode(await writeGnumeric(book, [], context()));
  expect(output).not.toContain("object-extension");
  expect(diagnostics.join("")).toBe("Unexpected element 'custom:extra' in state : \n\tWorkbook -> Sheets -> Sheet -> Objects -> CellComment\n");
});

it.each([10, 14])("drops unknown cells-container descendants but silently ignores unrecognized sheet/cell attributes in v%s", async version => {
  const diagnostics: string[] = [];
  const source = `<g:Workbook xmlns:g="http://www.gnumeric.org/v${version}.dtd"><g:Sheets><g:Sheet Bogus="yes"><g:Name>First</g:Name><g:Cells><g:Cell Row="0" Col="0" ValueType="60" Mystery="yes">one</g:Cell><g:Unexpected attr="1"/></g:Cells></g:Sheet></g:Sheets></g:Workbook>`;
  const book = await readGnumeric(new TextEncoder().encode(source), { ...context(), diagnostic: async diagnostic => { diagnostics.push(diagnostic.message); } });
  const output = new TextDecoder().decode(await writeGnumeric(book, [], context()));
  expect(output).not.toContain("Unexpected");
  expect(output).not.toContain("Bogus");
  expect(output).not.toContain("Mystery");
  expect(diagnostics.join("")).toBe("Unexpected element 'g:Unexpected' in state : \n\tWorkbook -> Sheets -> Sheet -> Cells\n");
});

it.each(["LE", "BE"])("imports UTF-16%s declarations and BOMs without losing Unicode", async order => {
  const source = '<?xml version="1.0" encoding="UTF-16"?>' + new TextDecoder().decode(xml('<g:Cells><g:Cell Row="0" Col="0" ValueType="60">Ω 😀</g:Cell></g:Cells>'));
  const bytes = new Uint8Array(source.length * 2 + 2);
  const view = new DataView(bytes.buffer);
  view.setUint16(0, 0xfeff, order === "LE");
  for (let i = 0; i < source.length; i++) view.setUint16(2 + i * 2, source.charCodeAt(i), order === "LE");
  const book = await readGnumeric(bytes, context());
  expect(book.sheets[0]!.cells[0]!.value).toEqual({ kind: "string", value: "Ω 😀" });
});

it("rejects XML syntax embedded in retained axis container attribute names", async () => {
  const book = { sheets: [{ id: "s1", name: "First", cells: [], rows: [], unsupportedRecords: [{ source: "Gnumeric_XmlIO:sax", kind: "Rows", disposition: "retained" as const,
    data: { name: "Rows", namespace: ns, text: "", children: [], attributes: [{ name: 'DefaultSizePts injected="yes"', namespace: "", value: "12" }] } }] }] };
  await expect(writeGnumeric(book, [], context())).rejects.toMatchObject({ code: "io" });
});

it("bounds recursive retained SDK records before JavaScript stack exhaustion", async () => {
  const cycle: { name: string; namespace: string; text: string; children: ImportedValue[]; attributes: ImportedValue[] } = { name: "Attribute", namespace: ns, text: "", children: [], attributes: [] };
  cycle.children.push(cycle);
  const book = { sheets: [], unsupportedRecords: [{ source: "Gnumeric_XmlIO:sax", kind: "Attributes", disposition: "retained" as const, data: cycle }] };
  await expect(writeGnumeric(book, [], context())).rejects.toMatchObject({ code: "resource-limit" });
});

it("reads nonzero integer axis flags with the native integer convention", async () => {
  // xml_sax_colrow uses gnm_xml_attr_int, then !hidden/is_collapsed.
  const book = await readGnumeric(xml('<g:Rows><g:RowInfo No="1" Unit="12" Hidden="2" Collapsed="-1"/></g:Rows>'), context());
  expect(book.sheets[0]!.rows![0]).toMatchObject({ index: 1, hidden: true, collapsed: true });
});

it("reads XML declarations separated by XML whitespace rather than only spaces", async () => {
  const source = '<?xml\nversion="1.0"\tencoding="ISO-8859-1"?>' + new TextDecoder().decode(xml('<g:Cells><g:Cell Row="0" Col="0" ValueType="60">café</g:Cell></g:Cells>'));
  const book = await readGnumeric(Uint8Array.from(source, character => character.charCodeAt(0)), context());
  expect(book.sheets[0]!.cells[0]!.value).toEqual({ kind: "string", value: "café" });
});

it.each(["gnm", "gmr"])("requires consistent SheetNameIndex when the native %s prefix selects a modern version", async prefix => {
  const source = `<${prefix}:Workbook xmlns:${prefix}="${ns}"><${prefix}:Sheets><${prefix}:Sheet><${prefix}:Name>First</${prefix}:Name></${prefix}:Sheet></${prefix}:Sheets></${prefix}:Workbook>`;
  await expect(readGnumeric(new TextEncoder().encode(source), context())).rejects.toMatchObject({ code: "io", message: "E File has inconsistent SheetNameIndex element." });
});

it("requires SheetNameIndex after a Version element even with a generic namespace prefix", async () => {
  const source = new TextDecoder().decode(xml("")).replace("<g:Sheets>", '<g:Version Epoch="1" Major="12" Minor="61"/><g:Sheets>');
  await expect(readGnumeric(new TextEncoder().encode(source), context())).rejects.toMatchObject({ code: "io", message: "E File has inconsistent SheetNameIndex element." });
});

it("does not infer a modern parser version from a generic prefix alone", async () => {
  const book = await readGnumeric(xml(""), context());
  expect(book.sheets[0]!.name).toBe("First");
});

it("uses the reserved xml prefix for XML-namespace record attributes", async () => {
  const book = { sheets: [{ id: "s1", name: "First", cells: [{ row: 0, column: 0, value: { kind: "number", value: 1 } as const,
    style: { gnumeric: { name: "Style", namespace: ns, text: "", children: [], attributes: [{ name: "lang", namespace: "http://www.w3.org/XML/1998/namespace", value: "en" }] } } }] }] };
  const bytes = await writeGnumeric(book, [], context());
  expect(new TextDecoder().decode(bytes)).toContain('xml:lang="en"');
  await expect(readGnumeric(bytes, context())).resolves.toMatchObject({ sheets: [{ name: "First" }] });
});

it("rejects the reserved xmlns namespace in SDK record data", async () => {
  const book = { sheets: [], unsupportedRecords: [{ source: "Gnumeric_XmlIO:sax", kind: "Attributes", disposition: "retained" as const,
    data: { name: "Attributes", namespace: "http://www.w3.org/2000/xmlns/", text: "", children: [], attributes: [] } }] };
  await expect(writeGnumeric(book, [], context())).rejects.toMatchObject({ code: "io" });
});

it("awaits overlapping gzip cleanup before the codec operation settles", async () => {
  let releaseRead!: (value: ReadableStreamReadResult<Uint8Array>) => void;
  let releaseCleanup!: () => void;
  let registered!: () => void;
  let cleanup!: () => void | Promise<void>;
  const readPending = new Promise<ReadableStreamReadResult<Uint8Array>>(resolve => { releaseRead = resolve; });
  const closing = new Promise<void>(resolve => { releaseCleanup = resolve; });
  const owned = new Promise<void>(resolve => { registered = resolve; });
  const cancel = vi.fn(() => closing), abort = vi.fn(() => closing);
  vi.stubGlobal("CompressionStream", class {
    readable = { getReader() { return { read() { return readPending; }, cancel }; } };
    writable = { getWriter() { return { async write() {}, async close() {}, abort }; } };
  });
  let settled = false;
  const pending = writeCompressedGnumeric({ sheets: [] }, [], { ...context(), own(fn) { cleanup = fn; registered(); } });
  void pending.then(() => { settled = true; }, () => { settled = true; });
  let firstCleanup: Promise<void> | undefined;
  try {
    await owned;
    firstCleanup = Promise.resolve(cleanup());
    releaseRead({ done: true, value: undefined });
    // Yield one event-loop turn so normal producer/finalizer work can settle.
    // Cooperative cleanup remains explicitly deferred, independent of timing.
    await new Promise<void>(resolve => setImmediate(resolve));
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(abort).toHaveBeenCalledTimes(1);
    expect(settled).toBe(false);
    releaseCleanup();
    await firstCleanup;
    await pending;
    expect(settled).toBe(true);
  } finally {
    releaseRead({ done: true, value: undefined });
    releaseCleanup();
    await Promise.allSettled([pending, firstCleanup]);
    vi.unstubAllGlobals();
  }
});
