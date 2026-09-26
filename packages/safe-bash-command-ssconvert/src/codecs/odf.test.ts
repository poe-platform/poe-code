import { expect, it } from "vitest";
import { Volume } from "memfs";
import { createZipCodec } from "@poe-code/office-package";
import { createEngine } from "../engine.js";
import type { CapabilityContext } from "../contracts.js";
import { readOdf, probeOdf } from "./odf.js";

export const context: CapabilityContext = { signal: new AbortController().signal, own() {},
  environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 100000, outputBytes: 100000, cells: 1000, sheets: 3, operations: 1000 } };
export const office = "urn:oasis:names:tc:opendocument:xmlns:office:1.0";
export const table = "urn:oasis:names:tc:opendocument:xmlns:table:1.0";
export const text = "urn:oasis:names:tc:opendocument:xmlns:text:1.0";
export function content(body: string, styles = "") {
  return `<office:document-content xmlns:office="${office}" xmlns:table="${table}" xmlns:text="${text}" xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0" xmlns:number="urn:oasis:names:tc:opendocument:xmlns:datastyle:1.0" office:version="1.2"><office:automatic-styles>${styles}</office:automatic-styles><office:body><office:spreadsheet>${body}</office:spreadsheet></office:body></office:document-content>`;
}
export async function fixture(parts: Readonly<Record<string, string>>) {
  const zip = createZipCodec(); const limits = { maxArchiveBytes: 100000, maxEntryBytes: 100000, maxTotalBytes: 100000,
    maxMembers: 100, maxPathBytes: 1024, maxDepth: 32, maxPaxBytes: 10000, maxTextBytes: 100000, chunkSize: 4096 };
  const entries = [];
  for (const [name, source] of Object.entries(parts)) entries.push(await zip.makeZipEntry(name, new TextEncoder().encode(source),
    { modified: new Date("2000-01-01Z"), mode: 0o644, directory: false, symlink: false, compression: "deflate" }, limits, context.signal));
  return zip.writeZipArchive({ entries, comment: new Uint8Array() }, limits, context.signal);
}
it("refuses encrypted OpenDocument before decoding ciphertext and before output admission", async () => {
  const manifest = '<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0"><manifest:file-entry manifest:full-path="content.xml"><manifest:encryption-data/></manifest:file-entry></manifest:manifest>';
  const bytes = await fixture({ mimetype: "application/vnd.oasis.opendocument.spreadsheet",
    "content.xml": "\u0000ciphertext is not XML", "META-INF/manifest.xml": manifest });
  const engine = createEngine({ codecs: [], environment: context.environment, limits: context.limits });
  let writes = 0;
  try {
    await expect(engine.convert({ input: { kind: "stream", source: [bytes], filename: "encrypted.ods" },
      exportType: "Gnumeric_stf:stf_csv", destination: { kind: "stream", sink: { async write() { writes++; } } }
    }, context)).rejects.toMatchObject({ code: "unsupported-feature", exitCode: 1,
      message: "Unsupported ssconvert feature: encrypted OpenDocument package" });
    expect(writes).toBe(0);
  } finally { await engine.dispose(); }
});

it("imports ODS through the shared engine with sparse repeats, cross-sheet formulas and caches", async () => {
  const bytes = await fixture({ mimetype: "application/vnd.oasis.opendocument.spreadsheet", "content.xml": content(
    `<table:table table:name="Input"><table:table-row table:number-rows-repeated="2"><table:table-cell office:value-type="float" office:value="7" table:number-columns-repeated="2"/></table:table-row><table:table-row table:number-rows-repeated="1000000"><table:table-cell table:number-columns-repeated="1000"/></table:table-row></table:table><table:table table:name="Output"><table:table-row><table:table-cell table:formula="of:=[Input.A1]+2" office:value-type="float" office:value="9"/></table:table-row></table:table>`) });
  const volume = new Volume(); volume.writeFileSync("/book.ods", bytes);
  const engine = createEngine({ codecs: [], environment: context.environment, limits: context.limits,
    filesystem: { async read(uri) { return [new Uint8Array(volume.readFileSync(uri) as Uint8Array)]; },
      async write(uri, data) { volume.writeFileSync(uri, data); } } });
  try {
    const book = await engine.readWorkbook({ kind: "resource", uri: "/book.ods" }, {}, context);
    expect(book.sheets[0]!.cells.map(c => [c.row, c.column, c.value])).toEqual([
      [0, 0, { kind: "number", value: 7 }], [0, 1, { kind: "number", value: 7 }],
      [1, 0, { kind: "number", value: 7 }], [1, 1, { kind: "number", value: 7 }]]);
    expect(book.sheets[1]!.cells[0]).toMatchObject({ formula: "=Input!A1+2", cachedResult: { kind: "number", value: 9 }, formulaDirty: true });
    expect(new Uint8Array(volume.readFileSync("/book.ods") as Uint8Array)).toEqual(bytes);
  } finally { await engine.dispose(); }
});
it("matches OpenCalc repeats: only the first cell keeps a formula, copies keep cached values", async () => {
  const book = await readOdf(await fixture({ mimetype: "application/vnd.oasis.opendocument.spreadsheet", "content.xml": content(
    `<table:table table:name="S"><table:table-row table:number-rows-repeated="2"><table:table-cell table:number-columns-repeated="2" table:formula="of:=1+2" office:value="99" office:value-type="float"/></table:table-row></table:table>`) }), context);
  expect(book.sheets[0]!.cells.map(c => [c.formula, c.value, c.cachedResult])).toEqual([
    ["=1+2", { kind: "number", value: 99 }, { kind: "number", value: 99 }],
    [undefined, { kind: "number", value: 99 }, undefined], [undefined, { kind: "number", value: 99 }, undefined],
    [undefined, { kind: "number", value: 99 }, undefined]]);
});
it("reads typed serials, multiline text, significant spaces, errors and covered merge positions", async () => {
  const book = await readOdf(await fixture({ mimetype: "application/vnd.oasis.opendocument.spreadsheet", "content.xml": content(
    `<table:table table:name="S"><table:table-row><table:table-cell office:value-type="date" office:date-value="1900-03-01T12:00:00"/><table:table-cell office:value-type="time" office:time-value="PT25H0M0S"/><table:table-cell office:value-type="boolean" office:boolean-value="true"/><table:table-cell office:value-type="string"><text:p>a<text:s text:c="3"/>b<text:tab/>c</text:p><text:p>d</text:p></table:table-cell><table:table-cell table:formula="of:=" office:value-type="string"><text:p>#DIV/0!</text:p></table:table-cell></table:table-row><table:table-row><table:table-cell office:value-type="string" table:number-columns-spanned="2" table:number-rows-spanned="2"><text:p>merge</text:p></table:table-cell><table:covered-table-cell/><table:table-cell office:value-type="float" office:value="4"/></table:table-row></table:table>`) }), context);
  expect(book.sheets[0]!.cells.slice(0, 4).map(c => c.value)).toEqual([
    { kind: "number", value: 61.5 }, { kind: "number", value: 25 / 24 }, { kind: "boolean", value: true },
    { kind: "error", value: "#DIV/0!" }]);
  expect(book.sheets[0]!.cells.filter(c => c.row === 0).map(c => c.column)).toEqual([0, 1, 2, 3]);
  expect(book.sheets[0]!.merges).toEqual([{ startRow: 1, startColumn: 0, endRow: 2, endColumn: 1 }]);
  expect(book.sheets[0]!.cells.at(-1)).toMatchObject({ row: 1, column: 2, value: { kind: "number", value: 4 } });
});
it("matches the two native content passes and ignores fake merge spans", async () => {
  const diagnostics: string[] = [];
  const book = await readOdf(await fixture({ mimetype: "application/vnd.oasis.opendocument.spreadsheet", "content.xml": content(
    '<table:table table:name="S"><table:unknown/><table:table-row><table:table-cell xmlns:g="http://www.gnumeric.org/odf-extension/1.0" g:columns-spanned-fake="true" table:number-columns-spanned="3" office:value="2"/></table:table-row></table:table>') }),
  { ...context, async diagnostic(d) { diagnostics.push(new TextDecoder().decode(d.bytes)); } });
  expect(diagnostics).toEqual(Array(2).fill("Unexpected element 'table:unknown' in state : \n\tdocument-content -> body -> spreadsheet -> table\n"));
  expect(book.sheets[0]!.merges).toEqual([]);
});
it("recognizes legacy MIME/namespace/value attributes and legacy ADDRESS convention", async () => {
  const xml = `<office:document-content xmlns:office="http://openoffice.org/2000/office" xmlns:table="http://openoffice.org/2000/table" xmlns:text="http://openoffice.org/2000/text"><office:body><table:table table:name="Legacy"><table:table-row><table:table-cell table:value-type="float" table:value="8"/><table:table-cell table:formula="=ADDRESS(1;2;3;&quot;Legacy&quot;)" table:string-value="B1"/></table:table-row></table:table></office:body></office:document-content>`;
  const bytes = await fixture({ mimetype: "application/vnd.sun.xml.calc", "content.xml": xml });
  expect(await probeOdf(bytes, context)).toBe(true);
  expect((await readOdf(bytes, context)).sheets[0]!.cells).toMatchObject([
    { value: { kind: "number", value: 8 } }, { formula: '=ADDRESS(1,2,3,1,"Legacy")', cachedResult: { kind: "string", value: "B1" } }]);
  expect(await probeOdf(await fixture({ "content.xml": xml }), { ...context, inputFilename: "legacy.stc" })).toBe(true);
  expect(await probeOdf(await fixture({ "content.xml": xml }), context)).toBe(false);
});
it.each(["application/vnd.oasis.opendocument.spreadsheet-template", "application/vnd.sun.xml.calc.template"])("supports requested template MIME %s", async mimetype => {
  expect(await probeOdf(await fixture({ mimetype, "content.xml": content('<table:table table:name="S"/>') }), context)).toBe(true);
});
it("retains local image bytes and embedded chart XML without fetching external drawing links", async () => {
  const bytes = await fixture({ mimetype: "application/vnd.oasis.opendocument.spreadsheet", "Pictures/image.png": "img",
    "Object 1/content.xml": '<office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0"><office:body/></office:document-content>',
    "content.xml": content('<table:table table:name="S"><table:table-row><table:table-cell office:value-type="string"><text:p>x</text:p><draw:frame xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0" xmlns:xlink="http://www.w3.org/1999/xlink"><draw:image xlink:href="./Pictures/image.png"/><draw:object xlink:href="./Object%201"/><draw:image xlink:href="https://example.invalid/image.png"/></draw:frame></table:table-cell></table:table-row></table:table>') });
  const book = await readOdf(bytes, context);
  expect(book.unsupportedRecords).toContainEqual({ source: "Gnumeric_OpenCalc:openoffice", kind: "embedded-resource", disposition: "retained",
    data: { path: "Pictures/image.png", encoding: "hex", bytes: "696d67" } });
  expect(book.unsupportedRecords?.some(r => r.kind === "embedded-document")).toBe(true);
  expect(JSON.stringify(book.sheets[0]!.unsupportedRecords)).toContain("https://example.invalid/image.png");
});
it("resolves column defaults separately across repeated cells and sizes axis metadata inclusively", async () => {
  const book = await readOdf(await fixture({ mimetype: "application/vnd.oasis.opendocument.spreadsheet", "content.xml": content(
    '<table:table table:name="S"><table:table-column table:default-cell-style-name="Whole"/><table:table-column table:default-cell-style-name="Decimal"/><table:table-column table:number-columns-repeated="255" table:visibility="collapse"/><table:table-row><table:table-cell table:number-columns-repeated="2" office:value="1"/></table:table-row></table:table>',
    '<number:number-style style:name="N0"><number:number number:decimal-places="0"/></number:number-style><number:number-style style:name="N2"><number:number number:decimal-places="2"/></number:number-style><style:style style:name="Whole" style:family="table-cell" style:data-style-name="N0"/><style:style style:name="Decimal" style:family="table-cell" style:data-style-name="N2"/>') }), context);
  expect(book.sheets[0]!.cells.map(c => c.format)).toEqual(["0", "0.00"]);
  expect(book.sheets[0]!.size?.columns).toBe(512);
  expect(book.sheets[0]!.columns?.at(-1)?.index).toBe(256);
});
it("bounds materialized repeats, XML and ZIP, and observes cancellation without external I/O", async () => {
  const bytes = await fixture({ mimetype: "application/vnd.oasis.opendocument.spreadsheet", "content.xml": content(
    '<table:table table:name="S"><table:table-row table:number-rows-repeated="100"><table:table-cell table:number-columns-repeated="100" office:value="1"/></table:table-row></table:table>') });
  await expect(readOdf(bytes, context)).rejects.toMatchObject({ code: "resource-limit" });
  await expect(readOdf(bytes, { ...context, limits: { ...context.limits, workbookNodes: 2 } })).rejects.toMatchObject({ code: "resource-limit" });
  const controller = new AbortController(), reason = new Error("cancelled"); controller.abort(reason);
  await expect(readOdf(bytes, { ...context, signal: controller.signal })).rejects.toBe(reason);
  await expect(readOdf(await fixture({ mimetype: "application/vnd.oasis.opendocument.spreadsheet", "content.xml": '<!DOCTYPE a [<!ENTITY x "x">]><a>&x;</a>' }), context)).rejects.toThrow();
});


it("keeps same-named Calc cell, sheet, row and column styles in separate families", async () => {
  const styles = '<number:number-style style:name="Decimal"><number:number number:decimal-places="2"/></number:number-style>' +
    '<style:style style:name="Shared" style:family="table-cell" style:data-style-name="Decimal"><style:text-properties fo:font-weight="bold"/></style:style>' +
    '<style:style style:name="Shared" style:family="table"><style:table-properties table:display="false"/></style:style>' +
    '<style:style style:name="Shared" style:family="table-row"><style:table-row-properties style:row-height="18pt"/></style:style>' +
    '<style:style style:name="Shared" style:family="table-column"><style:table-column-properties style:column-width="36pt"/></style:style>';
  const bytes = await fixture({ mimetype: "application/vnd.oasis.opendocument.spreadsheet", "content.xml": content(
    '<table:table table:name="S" table:style-name="Shared"><table:table-column table:style-name="Shared"/><table:table-row table:style-name="Shared"><table:table-cell table:style-name="Shared" office:value="1.25"/></table:table-row></table:table>', styles) });
  const sheet = (await readOdf(bytes, context)).sheets[0]!;
  expect(sheet.visibility).toBe("hidden");
  expect(sheet.rows?.[0]?.sizePoints).toBe(18);
  expect(sheet.columns?.[0]?.sizePoints).toBe(36);
  expect(sheet.cells[0]?.format).toBe("0.00");
  expect(sheet.cells[0]?.style?.gnumeric).toMatchObject({ children: expect.arrayContaining([
    expect.objectContaining({ name: "Font", attributes: expect.arrayContaining([{ name: "Bold", namespace: "", value: "1" }]) }),
  ]) });
});

it("does not inherit a format or reject a cycle from a different style family", async () => {
  const styles = '<number:number-style style:name="Decimal"><number:number number:decimal-places="2"/></number:number-style>' +
    '<style:style style:name="Parent" style:family="table-cell" style:data-style-name="Decimal"/>' +
    '<style:style style:name="Child" style:family="table-cell" style:parent-style-name="Parent"/>' +
    '<style:style style:name="Parent" style:family="paragraph" style:parent-style-name="Child"/>';
  const bytes = await fixture({ mimetype: "application/vnd.oasis.opendocument.spreadsheet", "content.xml": content(
    '<table:table table:name="S"><table:table-row><table:table-cell table:style-name="Child" office:value="2"/></table:table-row></table:table>', styles) });
  expect((await readOdf(bytes, context)).sheets[0]!.cells[0]?.format).toBe("0.00");
});
