import { expect, it } from "vitest";
import { createZipCodec } from "@poe-code/office-package";
import type { CapabilityContext } from "../contracts.js";
import type { ImportedValue, Workbook } from "../workbook.js";
import { createOdfWriter, readOdf } from "./odf.js";
import { createOdfXml, odfNamespaces, odfAttributes } from "./odf-write-support.js";
import { createOdfStyles } from "./odf-write-styles.js";
import { readGnumeric } from "./gnumeric.js";

const context: CapabilityContext = { signal: new AbortController().signal, own() {},
  environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 100000, outputBytes: 100000, cells: 1000, sheets: 3, operations: 1000 } };
const limits = { maxArchiveBytes: 100000, maxEntryBytes: 100000, maxTotalBytes: 100000,
  maxMembers: 100, maxPathBytes: 1024, maxDepth: 32, maxPaxBytes: 10000, maxTextBytes: 100000, chunkSize: 4096 };
async function fixture(content: string) {
  const zip = createZipCodec(), entries = [];
  for (const [name, text] of [["mimetype", "application/vnd.oasis.opendocument.spreadsheet"], ["content.xml", content]]) {
    entries.push(await zip.makeZipEntry(name!, new TextEncoder().encode(text),
      { modified: new Date("2000-01-01Z"), mode: 0o644, directory: false, symlink: false, compression: "deflate" }, limits, context.signal));
  }
  return zip.writeZipArchive({ entries, comment: new Uint8Array() }, limits, context.signal);
}
function document(body: string) {
  return `<office:document-content ${Object.entries(odfNamespaces).map(([prefix, uri]) => `xmlns:${prefix}="${uri}"`).join(" ")} office:version="1.2"><office:body><office:spreadsheet>${body}</office:spreadsheet></office:body></office:document-content>`;
}

it.each(["strict", "extended"] as const)("preserves original ODF text links in %s", async profile => {
  const original = await readOdf(await fixture(document('<table:table table:name="S"><table:table-row><table:table-cell office:value-type="string"><text:p>before <text:a xlink:href="https://example.invalid/?a=1&amp;b=2" xlink:type="simple">linked</text:a> after</text:p></table:table-cell></table:table-row></table:table>')), context);
  const round = await readOdf(await createOdfWriter(profile)(original, [], context), context);
  expect(round.sheets[0]!.cells[0]!.value).toEqual({ kind: "string", value: "before linked after" });
  expect(JSON.stringify(round)).toContain("https://example.invalid/?a=1&b=2");
});

it.each(["strict", "extended"] as const)("preserves repeated original ODF validations in %s", async profile => {
  const original = await readOdf(await fixture(document('<table:content-validations><table:content-validation table:name="V" table:condition="of:cell-content()&gt;0"/></table:content-validations><table:table table:name="S"><table:table-row table:number-rows-repeated="2"><table:table-cell table:number-columns-repeated="2" table:content-validation-name="V" office:value-type="float" office:value="3"/></table:table-row></table:table>')), context);
  const round = await readOdf(await createOdfWriter(profile)(original, [], context), context);
  const validated = round.sheets[0]!.unsupportedRecords?.filter(record => record.kind === "table-cell").map(record => record.data);
  expect(validated).toHaveLength(4);
  expect(validated).toEqual([
    expect.objectContaining({ row: 0, column: 0, validation: "V" }),
    expect.objectContaining({ row: 0, column: 1, validation: "V" }),
    expect.objectContaining({ row: 1, column: 0, validation: "V" }),
    expect.objectContaining({ row: 1, column: 1, validation: "V" })
  ]);
});

it("preserves link paragraphs on every repeated original cell", async () => {
  const original = await readOdf(await fixture(document('<table:table table:name="S"><table:table-row table:number-rows-repeated="2"><table:table-cell table:number-columns-repeated="2" office:value-type="string"><text:p><text:a xlink:href="https://example.invalid">linked</text:a></text:p></table:table-cell></table:table-row></table:table>')), context);
  const round = await readOdf(await createOdfWriter("extended")(original, [], context), context);
  expect(round.sheets[0]!.unsupportedRecords?.filter(record => record.kind === "p")).toHaveLength(4);
});

it.each(["strict", "extended"] as const)("keeps sparse merges and duplicate-address ordering without mutating %s input", async profile => {
  const original: Workbook = { sheets: [{ id: "S", name: "S", cells: [
    { row: 100, column: 7, value: { kind: "string", value: "old" } },
    { row: 0, column: 0, value: { kind: "boolean", value: false } },
    { row: 100, column: 7, value: { kind: "string", value: "last" } }
  ], merges: [{ startRow: 3, endRow: 9, startColumn: 2, endColumn: 5 }] }] };
  const before = JSON.stringify(original);
  const round = await readOdf(await createOdfWriter(profile)(original, [], context), context);
  expect(round.sheets[0]!.merges).toEqual(original.sheets[0]!.merges);
  expect(round.sheets[0]!.cells.filter(cell => cell.value.kind !== "blank")).toEqual([
    { row: 0, column: 0, value: { kind: "boolean", value: false } },
    { row: 100, column: 7, value: { kind: "string", value: "last" } }
  ]);
  expect(JSON.stringify(original)).toBe(before);
});

it("rejects retained cycles, observes borrowed cancellation and bounds metadata work", () => {
  const cyclic: Record<string, ImportedValue> = { name: "p", namespace: odfNamespaces.text!, children: [] };
  cyclic.children = [cyclic];
  expect(() => createOdfXml(context, true).retained(cyclic)).toThrow("Invalid cyclic OpenDocument metadata");
  expect(() => createOdfXml({ ...context, limits: { ...context.limits, workbookWork: 5 } }, true).text("123456")).toThrow("work limit");
  const controller = new AbortController(), reason = { cancelled: true }; controller.abort(reason);
  try { createOdfXml({ ...context, signal: controller.signal }, true).retained(cyclic); }
  catch (error) { expect(error).toBe(reason); return; }
  throw new Error("Cancellation was not observed");
});

it("prunes extension attributes and elements only in strict metadata", () => {
  const source: ImportedValue = { name: "style", namespace: odfNamespaces.style!, attributes: [
    { name: "name", namespace: odfNamespaces.style!, value: "C" },
    { name: "pattern", namespace: odfNamespaces.gnm!, value: "3" }
  ], children: [{ name: "foreign", namespace: odfNamespaces.gnm!, children: [] }] };
  const strict = createOdfXml(context, false).retained(source), extended = createOdfXml(context, true).retained(source);
  expect(strict).toBe('<style:style style:name="C"/>');
  expect(extended).toContain('gnm:pattern="3"');
  expect(extended).toContain("<gnm:foreign/>");
});

it.each([false, true])("orders automatic cell style properties according to ODF 1.2 (extended=%s)", extended => {
  const book: Workbook = { sheets: [{ id: "S", name: "S", cells: [] }] };
  const styles = createOdfStyles(createOdfXml(context, extended), extended, book, context);
  styles.register({ style: { gnumeric: { name: "Style", attributes: { HAlign: "2" }, children: [
    { name: "Font", attributes: { Bold: "1" }, text: "Sans" }
  ] } } });
  const style = styles.styles.join("");
  expect(style.indexOf("style:table-cell-properties")).toBeLessThan(style.indexOf("style:paragraph-properties"));
  expect(style.indexOf("style:paragraph-properties")).toBeLessThan(style.indexOf("style:text-properties"));
});

it("preserves indexed retained mixed text order and rejects invalid child indices", () => {
  const source: Record<string, ImportedValue> = { name: "p", namespace: odfNamespaces.text!, children: [
    { name: "a", namespace: odfNamespaces.text!, attributes: [
      { name: "href", namespace: odfNamespaces.xlink!, value: "https://example.invalid" }
    ], text: "middle" }
  ], content: [{ kind: "text", text: "before " }, { kind: "element", index: 0 }, { kind: "text", text: " after" }] };
  expect(createOdfXml(context, true).retained(source)).toBe('<text:p>before <text:a xlink:href="https://example.invalid">middle</text:a> after</text:p>');
  for (const index of [-1, 0.5, 1]) {
    source.content = [{ kind: "element", index }];
    expect(() => createOdfXml(context, true).retained(source)).toThrow("Invalid OpenDocument metadata child index");
  }
});

it("cancels during an admitted export without mutating the workbook", async () => {
  const controller = new AbortController(), reason = { cancelled: "during-export" };
  const book: Workbook = { sheets: [{ id: "S", name: "S", cells: [
    { row: 0, column: 0, value: { kind: "string", value: "unchanged" } }
  ] }] };
  const before = JSON.stringify(book);
  const exporting = createOdfWriter("extended")(book, [], { ...context, signal: controller.signal });
  queueMicrotask(() => controller.abort(reason));
  await expect(exporting).rejects.toBe(reason);
  expect(JSON.stringify(book)).toBe(before);
});

it("rejects XML-illegal scalar text instead of replacing its byte value", async () => {
  const book: Workbook = { sheets: [{ id: "S", name: "S", cells: [
    { row: 0, column: 0, value: { kind: "string", value: "a\u0000b" } }
  ] }] };
  await expect(createOdfWriter("extended")(book, [], context)).rejects.toThrow("non-XML OpenDocument character");
});

it("rejects cyclic style metadata with the public invalid-request error", () => {
  const cyclic: Record<string, ImportedValue> = { name: "Style", attributes: {}, children: [] };
  cyclic.children = [cyclic];
  const book: Workbook = { sheets: [{ id: "S", name: "S", cells: [] }] };
  const styles = createOdfStyles(createOdfXml(context, true), true, book, context);
  try { styles.register({ style: { gnumeric: cyclic } }); }
  catch (error) { expect(error).toMatchObject({ code: "invalid-request", message: "Invalid cyclic OpenDocument style metadata" }); return; }
  throw new Error("Cyclic style metadata was accepted");
});

it("does not collide generated cell styles with original ODF style names", async () => {
  const content = document('<table:table table:name="S"><table:table-row><table:table-cell table:style-name="ce0" office:value-type="float" office:value="1"/></table:table-row></table:table>').replace("<office:body>", '<office:automatic-styles><style:style style:name="ce0" style:family="table-cell"><style:text-properties fo:font-weight="bold"/></style:style></office:automatic-styles><office:body>');
  const original = await readOdf(await fixture(content), context);
  const input: Workbook = { ...original, sheets: original.sheets.map(sheet => ({ ...sheet, cells: [...sheet.cells,
    { row: 0, column: 1, value: { kind: "number" as const, value: 2 }, format: "0.00" }
  ] })) };
  const round = await readOdf(await createOdfWriter("extended")(input, [], context), context);
  expect(JSON.stringify(round.sheets[0]!.cells[0]!.style)).toContain("bold");
  expect(round.sheets[0]!.cells[1]!.format).toBe("0.00");
});

it("bounds style metadata depth and work before serialization", () => {
  const book: Workbook = { sheets: [{ id: "S", name: "S", cells: [] }] };
  let deep: ImportedValue = { name: "Font", text: "Sans" };
  for (let i = 0; i < 130; i++) deep = { name: "Style", children: [deep] };
  const styles = createOdfStyles(createOdfXml(context, true), true, book, context);
  expect(() => styles.register({ style: { gnumeric: deep } })).toThrow("style metadata depth limit");
  const bounded = { ...context, limits: { ...context.limits, workbookWork: 50 } };
  expect(() => createOdfStyles(createOdfXml(bounded, true), true, book, bounded).register({ style: {
    gnumeric: { name: "Style", children: [{ name: "Font", text: "a".repeat(100) }] }
  } })).toThrow("work limit");
});

it("preserves the resolved style at overlapping original Gnumeric regions", async () => {
  const source = `<g:Workbook xmlns:g="http://www.gnumeric.org/v10.dtd"><g:Sheets><g:Sheet><g:Name>S</g:Name><g:Styles>
    <g:StyleRegion startRow="0" endRow="1" startCol="0" endCol="1"><g:Style Format="0.0"/></g:StyleRegion>
    <g:StyleRegion startRow="0" endRow="0" startCol="0" endCol="0"><g:Style Format="0.00"/></g:StyleRegion>
    </g:Styles><g:Cells><g:Cell Row="0" Col="0" ValueType="40">3</g:Cell></g:Cells></g:Sheet></g:Sheets></g:Workbook>`;
  const original = await readGnumeric(new TextEncoder().encode(source), context);
  expect(original.sheets[0]!.cells[0]!.format).toBe("0.00");
  const round = await readOdf(await createOdfWriter("extended")(original, [], context), context);
  expect(round.sheets[0]!.cells[0]!.format).toBe(original.sheets[0]!.cells[0]!.format);
});

it("reads view flags from their own namespaces without same-local-name shadowing", async () => {
  const content = document('<table:table table:name="S" table:style-name="T"><table:table-row/></table:table>').replace("<office:body>", '<office:automatic-styles><style:style style:name="T" style:family="table"><style:table-properties style:writing-mode="rl-tb" gnm:writing-mode="lr-tb" gnm:display-formulas="true" style:display-col-header="false" gnm:display-col-header="true"/></style:style></office:automatic-styles><office:body>');
  const original = await readOdf(await fixture(content), context);
  expect(original.sheets[0]!.view?.gnumeric).toMatchObject({ RTL_Layout: "1", DisplayFormulas: "1", HideColHeader: "0" });
  const round = await readOdf(await createOdfWriter("extended")(original, [], context), context);
  expect(round.sheets[0]!.view?.gnumeric).toMatchObject({ RTL_Layout: "1", DisplayFormulas: "1", HideColHeader: "0" });
});

it.each(["strict", "extended"] as const)("accounts for original patterned fills through %s reopen", async profile => {
  const book: Workbook = { sheets: [{ id: "S", name: "S", cells: [
    { row: 0, column: 0, value: { kind: "string", value: "pattern" }, style: { gnumeric: {
      name: "Style", attributes: { Shade: "3", Back: "FFFF:0000:0000", PatternColor: "0000:FFFF:0000" }
    } } }
  ] }] };
  const round = await readOdf(await createOdfWriter(profile)(book, [], context), context);
  const attributes = odfAttributes(round.sheets[0]!.cells[0]!.style?.gnumeric);
  expect(attributes.Back).toBe("FFFF:0:0");
  expect(attributes.Shade).toBe(profile === "extended" ? "3" : "1");
  expect(attributes.PatternColor).toBe(profile === "extended" ? "0:FFFF:0" : undefined);
});
