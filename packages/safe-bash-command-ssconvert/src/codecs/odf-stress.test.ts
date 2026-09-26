import { expect, it } from "vitest";
import { createZipCodec } from "@poe-code/office-package";
import type { CapabilityContext } from "../contracts.js";
import { readOdf } from "./odf.js";

const context: CapabilityContext = { signal: new AbortController().signal, own() {},
  environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 100000, outputBytes: 100000, cells: 10000, sheets: 3, operations: 1000 } };
const office = "urn:oasis:names:tc:opendocument:xmlns:office:1.0";
const table = "urn:oasis:names:tc:opendocument:xmlns:table:1.0";
function content(body: string, styles = "") {
  return `<o:document-content xmlns:o="${office}" xmlns:t="${table}" xmlns:s="urn:oasis:names:tc:opendocument:xmlns:style:1.0" xmlns:f="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0" xmlns:tx="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:xl="http://www.w3.org/1999/xlink" o:version="1.2"><o:automatic-styles>${styles}</o:automatic-styles><o:body><o:spreadsheet>${body}</o:spreadsheet></o:body></o:document-content>`;
}
async function fixture(body: string, extra: Readonly<Record<string, string>> = {}) {
  const zip = createZipCodec();
  const limits = { maxArchiveBytes: 100000, maxEntryBytes: 100000, maxTotalBytes: 100000,
    maxMembers: 100, maxPathBytes: 1024, maxDepth: 32, maxPaxBytes: 10000, maxTextBytes: 100000, chunkSize: 4096 };
  const entries = [];
  for (const [name, source] of Object.entries({ mimetype: "application/vnd.oasis.opendocument.spreadsheet", "content.xml": content(body), ...extra })) {
    entries.push(await zip.makeZipEntry(name, new TextEncoder().encode(source), { modified: new Date("2000-01-01Z"), mode: 0o644,
      directory: false, symlink: false, compression: "deflate" }, limits, context.signal));
  }
  return zip.writeZipArchive({ entries, comment: new Uint8Array() }, limits, context.signal);
}
it("rejects an invalid styles root instead of silently treating it as empty styles", async () => {
  await expect(readOdf(await fixture('<t:table t:name="S"/>', { "styles.xml": '<unrelated/>' }), context))
    .rejects.toMatchObject({ code: "io" });
});
it("associates cached interior cells and implicit blank cells with their array group", async () => {
  const book = await readOdf(await fixture('<t:table t:name="S"><t:table-row><t:table-cell t:formula="of:=1" t:number-matrix-columns-spanned="2" t:number-matrix-rows-spanned="2" o:value="1"/><t:table-cell o:value="2"/></t:table-row><t:table-row><t:table-cell/><t:table-cell o:value="4"/></t:table-row></t:table>'), context);
  expect(book.sheets[0]!.cells.map(c => [c.row, c.column, c.formulaGroup, c.cachedResult])).toEqual([
    [0, 0, "array-0-0", { kind: "number", value: 1 }], [0, 1, "array-0-0", { kind: "number", value: 2 }],
    [1, 0, "array-0-0", undefined], [1, 1, "array-0-0", { kind: "number", value: 4 }],
  ]);
});
it("allows queued cancellation during repeated cell materialization", async () => {
  const bytes = await fixture('<t:table t:name="S"><t:table-row><t:table-cell t:formula="of:=???" o:value="1" t:number-columns-repeated="8000"/></t:table-row></t:table>');
  const controller = new AbortController(), reason = new Error("materialization cancelled");
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await expect(readOdf(bytes, { ...context, signal: controller.signal, async diagnostic() {
      timer = setTimeout(() => controller.abort(reason), 0);
    } })).rejects.toBe(reason);
  } finally { if (timer !== undefined) clearTimeout(timer); }
});
it("enforces workbook-wide materialized cell admission across sheets", async () => {
  const sheet = (name: string) => `<t:table t:name="${name}"><t:table-row><t:table-cell o:value="1" t:number-columns-repeated="3"/></t:table-row></t:table>`;
  await expect(readOdf(await fixture(sheet("A") + sheet("B")), { ...context, limits: { ...context.limits, cells: 5 } }))
    .rejects.toMatchObject({ code: "resource-limit" });
});
it("keeps a repeated empty million-row region sparse", async () => {
  const book = await readOdf(await fixture('<t:table t:name="S"><t:table-row t:number-rows-repeated="1000000"><t:table-cell t:number-columns-repeated="1000"/></t:table-row></t:table>'), context);
  expect(book.sheets[0]!.cells).toEqual([]);
});
it("uses the declared base sheet and coordinates for workbook named expressions", async () => {
  const book = await readOdf(await fixture('<t:table t:name="First"/><t:table t:name="Other"/><t:named-expressions><t:named-expression t:name="Offset" t:base-cell-address="$Other.$C$5" t:expression="of:=[.B4]+1"/></t:named-expressions>'), context);
  expect(book.names).toMatchObject([{ name: "Offset", position: { sheet: "Other", row: 4, column: 2 }, expression: "=B4+1" }]);
});
it("retains an unparsed formula with its coordinates and cached value", async () => {
  const book = await readOdf(await fixture('<t:table t:name="S"><t:table-row><t:table-cell t:formula="of:=???" o:value="19"/></t:table-row></t:table>'), context);
  expect(book.sheets[0]!.cells[0]!.value).toEqual({ kind: "number", value: 19 });
  expect(book.sheets[0]!.unsupportedRecords).toContainEqual(expect.objectContaining({ kind: "unparsed-formula", disposition: "retained",
    data: expect.objectContaining({ row: 0, column: 0, formula: "of:=???" }) }));
});
it("warns when an array expression omits a matrix axis", async () => {
  const messages: string[] = [];
  await readOdf(await fixture('<t:table t:name="S"><t:table-row><t:table-cell t:formula="of:=1" t:number-matrix-columns-spanned="2"/></t:table-row></t:table>'), {
    ...context, async diagnostic(d) { messages.push(d.message); },
  });
  expect(messages).toContain("S!A1 : Invalid array expression does not specify number of rows.\n");
});
it("imports external references as syntax without resolving injected external capability", async () => {
  let resolutions = 0;
  const book = await readOdf(await fixture('<t:table t:name="S"><t:table-row><t:table-cell t:formula="of:=[&apos;https://example.invalid/book.ods&apos;#Remote.A1]" o:value="7"/></t:table-row></t:table>'), {
    ...context, externalReferences: { resolve() { resolutions++; throw new Error("implicit external access"); } },
  });
  expect(resolutions).toBe(0);
  expect(book.sheets[0]!.cells[0]!.cachedResult).toEqual({ kind: "number", value: 7 });
});
it("preserves value-attribute order, ignoring values in unrelated namespaces", async () => {
  const book = await readOdf(await fixture('<t:table t:name="S"><t:table-row><t:table-cell xmlns:x="https://example.invalid/extension" x:value="99" o:boolean-value="true" o:value="3"/><t:table-cell o:value="3" o:boolean-value="true"/></t:table-row></t:table>'), context);
  expect(book.sheets[0]!.cells.map(c => c.value)).toEqual([{ kind: "boolean", value: true }, { kind: "number", value: 3 }]);
});
it("marks a formula without a supplied cache dirty while retaining no invented cache", async () => {
  const book = await readOdf(await fixture('<t:table t:name="S"><t:table-row><t:table-cell t:formula="of:=1+2"/></t:table-row></t:table>'), context);
  expect(book.sheets[0]!.cells[0]).toMatchObject({ formula: "=1+2", formulaDirty: true, value: { kind: "blank" } });
  expect(book.sheets[0]!.cells[0]!.cachedResult).toBeUndefined();
});

it("integrates inherited exportable styles through the actual reader", async () => {
  const body = '<t:table t:name="S"><t:table-row><t:table-cell t:style-name="Child" o:value="3"/></t:table-row></t:table>';
  const styles = '<s:style s:name="Parent" s:family="table-cell"><s:text-properties f:font-family="Serif" f:font-weight="bold"/></s:style><s:style s:name="Child" s:family="table-cell" s:parent-style-name="Parent"><s:table-cell-properties f:background-color="#ff0000"/></s:style>';
  const book = await readOdf(await fixture(body, { "content.xml": content(body, styles) }), context);
  expect(book.sheets[0]!.cells[0]!.style?.gnumeric).toMatchObject({ name: "Style", attributes: expect.arrayContaining([{ name: "Back", namespace: "", value: "FFFF:0:0" }]),
    children: expect.arrayContaining([expect.objectContaining({ name: "Font", text: "Serif", attributes: expect.arrayContaining([{ name: "Bold", namespace: "", value: "1" }]) })]) });
});
it("integrates passive annotations, hyperlinks and database filters into exportable records", async () => {
  const body = '<t:table t:name="S"><t:table-row><t:table-cell o:value-type="string"><tx:p><tx:a xl:href="https://example.invalid/link">label</tx:a></tx:p><o:annotation><dc:creator>Ada</dc:creator><tx:p>note</tx:p></o:annotation></t:table-cell></t:table-row></t:table><t:database-ranges><t:database-range t:target-range-address="S.A1:S.B4" t:display-filter-buttons="true"><t:filter><t:filter-condition t:field-number="0" t:operator="=" t:data-type="number" t:value="5"/></t:filter></t:database-range></t:database-ranges>';
  const book = await readOdf(await fixture(body), context), records = book.sheets[0]!.unsupportedRecords;
  expect(records).toEqual(expect.arrayContaining([expect.objectContaining({ source: "Gnumeric_XmlIO:sax", kind: "Objects" }),
    expect.objectContaining({ source: "Gnumeric_XmlIO:sax", kind: "Styles" }), expect.objectContaining({ source: "Gnumeric_XmlIO:sax", kind: "Filters" })]));
  expect(JSON.stringify(records)).toContain('https://example.invalid/link');
  expect(JSON.stringify(records)).toContain('CellComment');
});
it("preserves inherited border sides when a child overrides another side", async () => {
  const body = '<t:table t:name="S"><t:table-row><t:table-cell t:style-name="Child" o:value="3"/></t:table-row></t:table>';
  const styles = '<s:style s:name="Parent" s:family="table-cell"><s:table-cell-properties f:border-top="1pt solid #ff0000" f:border-left="1pt solid #ff0000"/></s:style><s:style s:name="Child" s:family="table-cell" s:parent-style-name="Parent"><s:table-cell-properties f:border-bottom="1pt solid #0000ff" f:border-left="none"/></s:style>';
  const book = await readOdf(await fixture(body, { "content.xml": content(body, styles) }), context);
  const rendered = JSON.stringify(book.sheets[0]!.cells[0]!.style?.gnumeric);
  expect(rendered).toContain('"name":"Top"');
  expect(rendered).toContain('"name":"Bottom"');
  expect(book.sheets[0]!.cells[0]!.style?.gnumeric).toMatchObject({ children: expect.arrayContaining([
    expect.objectContaining({ name: "StyleBorder", children: expect.arrayContaining([
      expect.objectContaining({ name: "Left", attributes: expect.arrayContaining([{ name: "Style", namespace: "", value: "0" }]) }),
    ]) }),
  ]) });
});
it("maps database ranges for quoted sheet names containing dots", async () => {
  const book = await readOdf(await fixture('<t:table t:name="Q.1"/><t:database-ranges><t:database-range t:target-range-address="$&apos;Q.1&apos;.$A$1:$&apos;Q.1&apos;.$B$4" t:display-filter-buttons="true"/></t:database-ranges>'), context);
  expect(book.sheets[0]!.unsupportedRecords).toContainEqual(expect.objectContaining({ source: "Gnumeric_XmlIO:sax", kind: "Filters", data: expect.objectContaining({ children: expect.arrayContaining([
    expect.objectContaining({ name: "Filter", attributes: expect.arrayContaining([{ name: "Area", namespace: "", value: "A1:B4" }]) }),
  ]) }) }));
});
it("preserves annotation inline spans and significant whitespace in paragraph order", async () => {
  const book = await readOdf(await fixture('<t:table t:name="S"><t:table-row><t:table-cell><o:annotation><tx:p>a<tx:span>b</tx:span>c<tx:s tx:c="2"/>d<tx:tab/>e<tx:line-break/>f</tx:p><tx:p>last</tx:p></o:annotation></t:table-cell></t:table-row></t:table>'), context);
  expect(book.sheets[0]!.unsupportedRecords).toContainEqual(expect.objectContaining({ kind: "Objects", data: expect.objectContaining({ children: expect.arrayContaining([
    expect.objectContaining({ name: "CellComment", attributes: expect.arrayContaining([{ name: "Text", namespace: "", value: "abc  d\te\nf\nlast" }]) }),
  ]) }) }));
});
it("matches native hyperlink URI-prefix classes and current-workbook target conversion", async () => {
  const links = ['#Sheet.A1', 'Sheet.B2', 'mail-other', 'file-relative'].map(href => `<t:table-cell o:value-type="string"><tx:p><tx:a xl:href="${href}">label</tx:a></tx:p></t:table-cell>`).join('');
  const book = await readOdf(await fixture(`<t:table t:name="S"><t:table-row>${links}</t:table-row></t:table>`), context);
  const serialized = JSON.stringify(book.sheets[0]!.unsupportedRecords);
  expect(serialized).toContain('"value":"Sheet!A1"');
  expect(serialized).toContain('"value":"Sheet!B2"');
  expect(serialized).toContain('"value":"GnmHLinkEMail"');
  expect(serialized).toContain('"value":"GnmHLinkExternal"');
});
it("admits annotation space expansion to the shared work budget before allocating it", async () => {
  const bytes = await fixture('<t:table t:name="S"><t:table-row><t:table-cell><o:annotation><tx:p><tx:s tx:c="100000001"/></tx:p></o:annotation></t:table-cell></t:table-row></t:table>');
  await expect(readOdf(bytes, context)).rejects.toMatchObject({ code: "resource-limit" });
});
const drawing = 'urn:oasis:names:tc:opendocument:xmlns:drawing:1.0';
function drawingSheet(relationships: string) {
  return `<t:table t:name="S"><t:table-row><t:table-cell xmlns:d="${drawing}"><d:frame>${relationships}</d:frame></t:table-cell></t:table-row></t:table>`;
}
it("deduplicates cyclic embedded-object relationships and resolves images relative to their object", async () => {
  const body = drawingSheet('<d:object xl:href="Object"/><d:image xl:href="Pictures/image"/>');
  const object = `<o:document-content xmlns:o="${office}" xmlns:d="${drawing}" xmlns:xl="http://www.w3.org/1999/xlink"><o:body><d:object xl:href="."/><d:image xl:href="../Pictures/image"/></o:body></o:document-content>`;
  const book = await readOdf(await fixture(body, { 'Object/content.xml': object, 'Pictures/image': 'A\u0000Z' }), context);
  expect(book.unsupportedRecords?.filter(r => r.kind === 'embedded-document').map(r => r.data)).toHaveLength(1);
  expect(book.unsupportedRecords?.filter(r => r.kind === 'embedded-resource').map(r => r.data)).toEqual([
    { path: 'Pictures/image', encoding: 'hex', bytes: '41005a' },
  ]);
});
it("charges all retained embedded-resource hex strings to one aggregate text budget", async () => {
  const body = drawingSheet('<d:image xl:href="Pictures/a"/><d:image xl:href="Pictures/b"/>');
  const bytes = await fixture(body, { 'Pictures/a': 'a'.repeat(80), 'Pictures/b': 'b'.repeat(80) });
  await expect(readOdf(bytes, { ...context, limits: { ...context.limits, workbookTextBytes: new TextEncoder().encode(content(body)).length + 250 } }))
    .rejects.toMatchObject({ code: 'resource-limit' });
});
it("keeps missing/external drawing relationships passive and refuses package-escaping traversal", async () => {
  const body = drawingSheet('<d:image xl:href="https://example.invalid/image"/><d:object xl:href="//example.invalid/object"/><d:image xl:href="missing"/>');
  const book = await readOdf(await fixture(body), context);
  expect(book.unsupportedRecords?.filter(r => r.kind.startsWith('embedded-'))).toEqual([]);
  await expect(readOdf(await fixture(drawingSheet('<d:image xl:href="../escape"/>')), context)).rejects.toMatchObject({ code: 'io' });
});
it("queues cached formulas dirty while retaining the supplied cache for import inspection", async () => {
  const book = await readOdf(await fixture('<t:table t:name="S"><t:table-row><t:table-cell t:formula="of:=1+2" o:value="99"/></t:table-row></t:table>'), context);
  expect(book.sheets[0]!.cells[0]).toMatchObject({ formula: '=1+2', formulaDirty: true, cachedResult: { kind: 'number', value: 99 } });
});
it("preserves both native parser passes' unknown-element warning ordering", async () => {
  const messages: string[] = [];
  await readOdf(await fixture('<t:table t:name="S"><t:unknown/><t:other/></t:table>'), { ...context, async diagnostic(d) { messages.push(d.message); } });
  expect(messages).toHaveLength(4);
  expect(messages[0]).toContain("'t:unknown'");
  expect(messages[1]).toContain("'t:other'");
  expect(messages[2]).toBe(messages[0]);
  expect(messages[3]).toBe(messages[1]);
});
it("preserves cancellation reason while an embedded resource is pending after the main parser", async () => {
  const body = drawingSheet('<d:object xl:href="Object"/>').replace('</t:table>', '<t:unknown/></t:table>');
  const embedded = `<o:document-content xmlns:o="${office}"><o:body>${'<o:body/>'.repeat(200)}</o:body></o:document-content>`;
  const bytes = await fixture(body, { 'Object/content.xml': embedded }), controller = new AbortController(), reason = new Error('embedded cancelled');
  let warnings = 0, timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await expect(readOdf(bytes, { ...context, signal: controller.signal, async diagnostic() {
      if (++warnings === 2) timer = setTimeout(() => controller.abort(reason), 0);
    } })).rejects.toBe(reason);
    expect(warnings).toBe(2);
  } finally { if (timer !== undefined) clearTimeout(timer); }
});
it("aggregates XML node budgets across embedded documents rather than resetting per relationship", async () => {
  const body = drawingSheet('<d:object xl:href="A"/><d:object xl:href="B"/>');
  const embedded = `<o:document-content xmlns:o="${office}"><o:body>${'<o:body/>'.repeat(30)}</o:body></o:document-content>`;
  await expect(readOdf(await fixture(body, { 'A/content.xml': embedded, 'B/content.xml': embedded }), {
    ...context, limits: { ...context.limits, workbookNodes: 60 },
  })).rejects.toMatchObject({ code: 'resource-limit' });
});
it("admits scientific exponent formatting expansion to the shared work budget", async () => {
  const body = '<t:table t:name="S"/>', styles = '<n:number-style xmlns:n="urn:oasis:names:tc:opendocument:xmlns:datastyle:1.0" s:name="Scientific"><n:scientific-number n:decimal-places="0" n:min-integer-digits="1" n:min-exponent-digits="20000"/></n:number-style>';
  await expect(readOdf(await fixture(body, { 'content.xml': content(body, styles) }), {
    ...context, limits: { ...context.limits, workbookWork: 10000 },
  })).rejects.toMatchObject({ code: 'resource-limit' });
});
