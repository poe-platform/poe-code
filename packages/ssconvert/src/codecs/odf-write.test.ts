import { expect, it } from "vitest";
import { Volume } from "memfs";
import { createZipCodec } from "@poe-code/office-package";
import { createEngine } from "../engine.js";
import { runCommand } from "../cli.js";
import { createRegistry } from "./registry.js";
import type { Workbook } from "../workbook.js";
import { readGnumeric } from "./gnumeric.js";
import { readOdf, createOdfWriter } from "./odf.js";
import type { CapabilityContext } from "../contracts.js";
import { odfAttributes, odfChildren, odfObject } from "./odf-write-support.js";
import { odfNamespaces } from "./odf-write-support.js";

it("does not let foreign attributes replace ODF attribute identities", () => {
  const node = { attributes: [
    { name: "name", namespace: odfNamespaces.style!, value: "original" },
    { name: "name", namespace: "urn:foreign", value: "collision" }
  ] };
  expect(odfAttributes(node, odfNamespaces.style).name).toBe("original");
});

export const context: CapabilityContext = { signal: new AbortController().signal, own() {},
  environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 100000, outputBytes: 100000, cells: 1000, sheets: 3, operations: 1000 } };

const limits = { maxArchiveBytes: 100000, maxEntryBytes: 100000, maxTotalBytes: 100000,
  maxMembers: 100, maxPathBytes: 1024, maxDepth: 32, maxPaxBytes: 10000, maxTextBytes: 100000, chunkSize: 4096 };
export async function unpackOdf(bytes: Uint8Array) {
  const zip = createZipCodec();
  const archive = await zip.readZipArchive(bytes, limits, context.signal);
  const parts = new Map<string, string>();
  for (const entry of archive.entries) {
    const chunks: Uint8Array[] = [];
    for await (const chunk of zip.decodeZipEntry(entry, limits, context.signal)) chunks.push(chunk);
    parts.set(entry.name, Buffer.concat(chunks).toString("utf8"));
  }
  return { parts, archive };
}

const book: Workbook = { dateSystem: "1904", names: [{ name: "Total", expression: "=S!$B$1" }],
  iteration: { enabled: true, maximum: 23, tolerance: 0.002 }, sheets: [{ id: "s", name: "S", cells: [
    { row: 0, column: 1, formula: "=1+2", value: { kind: "number", value: 3 }, cachedResult: { kind: "number", value: 3 } },
    { row: 0, column: 0, value: { kind: "string", value: " a  &b\t\nc " } },
    { row: 0, column: 2, value: { kind: "error", value: "#DIV/0!" } },
    { row: 100, column: 3, value: { kind: "boolean", value: true } }
  ], merges: [{ startRow: 2, endRow: 3, startColumn: 0, endColumn: 1 }] }] };

it.each(["openoffice", "odf"])("writes %s through the SDK with native error literal extension policy", async profile => {
  const engine = createEngine({ codecs: [{ id: "fixture", description: "fixture", extensions: [], async read() { return book; } }],
    environment: context.environment, limits: context.limits });
  const output: Uint8Array[] = [];
  try {
    const owned = await engine.readWorkbook({ kind: "stream", source: [] }, { importType: "fixture" }, context);
    const result = await engine.writeWorkbook(owned, { kind: "stream", sink: { async write(bytes) { output.push(new Uint8Array(bytes)); } } },
      { exportType: `Gnumeric_OpenCalc:${profile}` }, context);
    expect(result.exitCode).toBe(0);
    const { parts, archive } = await unpackOdf(output[0]!);
    expect(archive.entries[0]!.name).toBe("mimetype");
    expect(parts.get("mimetype")).toBe("application/vnd.oasis.opendocument.spreadsheet");
    expect([...parts.keys()]).toEqual(["mimetype", "content.xml", "styles.xml", "meta.xml", "settings.xml", "META-INF/manifest.xml"]);
    const xml = parts.get("content.xml")!;
    expect(xml).toContain('office:version="1.2"');
    expect(xml).toContain('table:formula="of:=1+2"');
    expect(xml).toContain('table:formula="of:=#DIV/0!"');
    expect(xml.includes('gnm:error-value="#DIV/0!"')).toBe(profile === "odf");
    if (profile === "odf") expect(xml.indexOf('gnm:error-value=')).toBeLessThan(xml.indexOf('table:formula="of:=#DIV/0!"'));
    expect(xml).toContain('table:number-rows-repeated="96"');
    expect(xml).toContain("table:covered-table-cell");
    expect(parts.get("META-INF/manifest.xml")).toContain('manifest:full-path="/"');
    expect(parts.get("settings.xml")).toContain(`<config:config-item config:name="gnm:has_foreign" config:type="boolean">${profile === "odf"}</config:config-item>`);
    const reopened = await engine.readWorkbook({ kind: "stream", filename: "book.ods", source: output }, {}, context);
    expect(reopened.dateSystem).toBe("1904");
    expect(reopened.sheets[0]!.cells[0]!.value).toEqual(book.sheets[0]!.cells[1]!.value);
    expect(reopened.sheets[0]!.cells[1]).toMatchObject({ formula: "=1+2", cachedResult: { kind: "number", value: 3 } });
    expect(reopened.sheets[0]!.cells[2]).toMatchObject(profile === "odf" ? { value: { kind: "error", value: "#DIV/0!" } } : { formula: "=#DIV/0!" });
    if (profile === "odf") expect(reopened.sheets[0]!.cells[2]!.formula).toBeUndefined();
    expect(reopened.sheets[0]!.merges).toEqual(book.sheets[0]!.merges);
    expect(reopened.names?.[0]).toMatchObject({ name: "Total", expression: "=S!$B$1" });
  } finally { await engine.dispose(); }
});

it("automatically resolves .ods to extended and writes command files through injected memfs", async () => {
  expect(createRegistry([]).select("write", undefined, "out.ods")?.id).toBe("Gnumeric_OpenCalc:odf");
  const volume = Volume.fromJSON({ "/in.csv": "x,3\n" });
  const engine = createEngine({ codecs: [], environment: context.environment, limits: context.limits,
    filesystem: { async read(uri, signal) { signal.throwIfAborted(); return [new Uint8Array(volume.readFileSync(uri) as Uint8Array)]; },
      async write(uri, bytes, signal) { signal.throwIfAborted(); volume.writeFileSync(uri, bytes); } } });
  try {
    const result = await runCommand(["/in.csv", "/out.ods"], engine, { ...context,
      stdout: { async write() {} }, stderr: { async write() {} } });
    expect(result.exitCode).toBe(0);
    expect((await unpackOdf(new Uint8Array(volume.readFileSync("/out.ods") as Uint8Array))).parts.get("content.xml")).toContain("<text:p>x</text:p>");
  } finally { await engine.dispose(); }
});

it.each(["strict", "extended"] as const)("exports original Gnumeric style/print/comment/link records with %s loss policy", async profile => {
  const source = `<g:Workbook xmlns:g="http://www.gnumeric.org/v10.dtd"><g:Sheets><g:Sheet><g:Name>S</g:Name>
    <g:PrintInformation><g:Margins><g:top Points="42" PrefUnit="mm"/></g:Margins><g:orientation>landscape</g:orientation><g:Scale type="fit" cols="2" rows="3"/></g:PrintInformation>
    <g:Styles><g:StyleRegion startCol="0" startRow="0" endCol="0" endRow="0"><g:Style Format="0.00" Shade="3" Back="FFFF:0000:0000" PatternColor="0000:FFFF:0000" WrapText="1"><g:Font Unit="12" Bold="1">Sans</g:Font><g:HyperLink type="GnmHLinkURL" target="https://example.invalid/a?b=1&amp;c=2"/></g:Style></g:StyleRegion></g:Styles>
    <g:Objects><g:CellComment ObjectBound="A1" Author="A" Text="hello"/></g:Objects><g:Cells><g:Cell Row="0" Col="0" ValueType="40">3.25</g:Cell></g:Cells></g:Sheet></g:Sheets></g:Workbook>`;
  const original = await readGnumeric(new TextEncoder().encode(source), context);
  const { parts } = await unpackOdf(await createOdfWriter(profile)(original, [], context));
  const xml = parts.get("content.xml")!;
  expect(xml).toContain('fo:font-weight="bold"');
  expect(xml).toContain('fo:font-size="12pt"');
  expect(xml).toContain('fo:background-color="#ff0000"');
  expect(xml.includes('gnm:pattern="3"')).toBe(profile === "extended");
  expect(xml).toContain("<office:annotation>"); expect(xml).toContain("<dc:creator>A</dc:creator>");
  expect(xml).toContain('xlink:href="https://example.invalid/a?b=1&amp;c=2"');
  const styles = parts.get("styles.xml")!;
  expect(styles).toContain('fo:margin-top="42pt"');
  expect(styles).toContain('style:print-orientation="landscape"');
  expect(styles).toContain(profile === "extended" ? 'gnm:scale-to-X="2"' : 'style:scale-to-pages="6"');
  const round = await readOdf(await createOdfWriter(profile)(original, [], context), context);
  expect(round.sheets[0]!.cells[0]!.format).toBe("0.00");
  expect(JSON.stringify(round.sheets[0]!.cells[0]!.style?.gnumeric)).toContain('"Bold"');
  expect(odfAttributes(round.sheets[0]!.cells[0]!.style?.gnumeric).Shade).toBe(profile === "extended" ? "3" : "1");
  const print = round.sheets[0]!.unsupportedRecords?.find(r => r.kind === "PrintInformation")?.data;
  const scale = odfChildren(print).find(n => odfObject(n)?.name === "Scale");
  expect(odfAttributes(scale)).toMatchObject(profile === "extended" ? { type: "fit", cols: "2", rows: "3" } : { type: "fit", cols: "6", rows: "6" });
  expect(JSON.stringify(round.sheets[0]!.unsupportedRecords)).toContain('hello');
});

it("translates original OpenFormula calls, quotes and unknown function prefixes", async () => {
  const input: Workbook = { sheets: [{ id: "s", name: "A B", cells: [
    { row: 0, column: 0, formula: '=SUM(\'A B\'!$B$2,TRUE,"a\\"b")+UNMEASURED(1)', value: { kind: "number", value: 0 } }
  ] }] };
  const xml = (await unpackOdf(await createOdfWriter("strict")(input, [], context))).parts.get("content.xml")!;
  expect(xml).toContain('of:=SUM([&apos;A B&apos;.$B$2];TRUE();&quot;a&quot;&quot;b&quot;)+ORG.GNUMERIC.UNMEASURED(1)'.split("&apos;").join("'"));
});

it("preserves original ODF conditional styles, validations and embedded image/chart parts", async () => {
  const ns = "urn:oasis:names:tc:opendocument:xmlns:";
  const originalParts: Record<string,string> = {
    mimetype: "application/vnd.oasis.opendocument.spreadsheet",
    "content.xml": `<office:document-content xmlns:office="${ns}office:1.0" xmlns:table="${ns}table:1.0" xmlns:style="${ns}style:1.0" xmlns:text="${ns}text:1.0" xmlns:number="${ns}datastyle:1.0" xmlns:draw="${ns}drawing:1.0" xmlns:xlink="http://www.w3.org/1999/xlink" office:version="1.2">
      <office:automatic-styles><number:number-style style:name="N"><number:number number:decimal-places="2"/></number:number-style><style:style style:name="C" style:family="table-cell" style:data-style-name="N"><style:map style:condition="cell-content()&gt;0" style:apply-style-name="C"/></style:style></office:automatic-styles>
      <office:body><office:spreadsheet><table:content-validations><table:content-validation table:name="V" table:condition="of:cell-content()&gt;0"/></table:content-validations><table:table table:name="S"><table:table-row><table:table-cell table:style-name="C" table:content-validation-name="V" office:value-type="float" office:value="3"><text:p>3</text:p><draw:frame><draw:image xlink:href="./Pictures/p.png"/><draw:object xlink:href="./Object%201"/></draw:frame></table:table-cell></table:table-row></table:table></office:spreadsheet></office:body></office:document-content>`,
    "Pictures/p.png": "original-image-bytes",
    "Object 1/content.xml": `<office:document-content xmlns:office="${ns}office:1.0" xmlns:chart="${ns}chart:1.0"><office:body><office:chart><chart:chart chart:class="chart:bar"/></office:chart></office:body></office:document-content>`,
    "Object 1/styles.xml": `<office:document-styles xmlns:office="${ns}office:1.0"><office:styles/></office:document-styles>`
  };
  const zip = createZipCodec(), entries = [];
  for (const [name,value] of Object.entries(originalParts)) entries.push(await zip.makeZipEntry(name, new TextEncoder().encode(value),
    { modified: new Date("2000-01-01Z"), mode: 0o644, directory: false, symlink: false, compression: "deflate" }, limits, context.signal));
  const original = await readOdf(await zip.writeZipArchive({ entries, comment: new Uint8Array() }, limits, context.signal), context);
  for (const profile of ["strict", "extended"] as const) {
    const bytes = await createOdfWriter(profile)(original, [], context), { parts } = await unpackOdf(bytes);
    expect(parts.get("Pictures/p.png")).toBe(originalParts["Pictures/p.png"]);
    expect(parts.get("Object 1/content.xml")).toContain('chart:class="chart:bar"');
    expect(parts.get("Object 1/styles.xml")).toContain("<office:document-styles ");
    const xml = parts.get("content.xml")!;
    expect(xml).toContain('table:content-validation-name="V"');
    expect(xml).toContain('style:condition="cell-content()&gt;0"');
    expect(xml).toContain('xlink:href="./Object%201"');
    expect(parts.get("META-INF/manifest.xml")).toContain('manifest:full-path="Pictures/p.png"');
    expect(parts.get("META-INF/manifest.xml")).toContain('manifest:full-path="Object 1/"');
    const round = await readOdf(bytes, context);
    expect(round.sheets[0]!.cells[0]!.format).toBe("0.00");
    expect(round.unsupportedRecords?.filter(r => r.kind === "embedded-resource")).toHaveLength(1);
  }
});

it("combines retained style containers in document order without duplicate master styles", async () => {
  const input: Workbook = { sheets: [{ id: "s", name: "S", cells: [] }], unsupportedRecords:
    ["styles", "master-styles", "font-face-decls"].map(kind => ({ source: "Gnumeric_OpenCalc:openoffice", kind, disposition: "retained" as const,
      data: { xml: { name: kind, namespace: odfNamespaces.office!, attributes: [], children: [] } } })) };
  const parts = (await unpackOdf(await createOdfWriter("strict")(input, [], context))).parts;
  const styles = parts.get("styles.xml")!;
  expect(styles.split("<office:master-styles")).toHaveLength(2);
  expect(styles.indexOf("<office:font-face-decls")).toBeLessThan(styles.indexOf("<office:styles"));
  expect(styles.indexOf("<office:automatic-styles")).toBeLessThan(styles.indexOf("<office:master-styles"));
});

it("cancels and rejects insufficient budgets before any file publication", async () => {
  const volume = Volume.fromJSON({ "/in.csv": "x\n", "/out.ods": "old" }); let writes = 0;
  const engine = createEngine({ codecs: [], environment: context.environment, limits: { ...context.limits, outputBytes: 100 },
    filesystem: { async read(uri) { return [new Uint8Array(volume.readFileSync(uri) as Uint8Array)]; }, async write() { writes++; } } });
  try {
    const result = await runCommand(["/in.csv", "/out.ods"], engine, { ...context, stdout: { async write() {} }, stderr: { async write() {} } });
    expect(result.exitCode).not.toBe(0); expect(writes).toBe(0); expect(volume.readFileSync("/out.ods", "utf8")).toBe("old");
  } finally { await engine.dispose(); }
  const controller = new AbortController(), reason = { cancelled: true }; controller.abort(reason);
  await expect(createOdfWriter("extended")(book, [], { ...context, signal: controller.signal })).rejects.toBe(reason);
});

it("exports dates, elapsed times, error caches and array corners with original scalar semantics", async () => {
  const original: Workbook = { dateSystem: "1904", sheets: [{ id: "s", name: "S", cells: [
    { row: 0, column: 0, value: { kind: "number", value: 1.5 }, format: "yyyy-mm-dd hh:mm:ss" },
    { row: 0, column: 1, value: { kind: "number", value: 25/24 }, format: "[h]:mm:ss" },
    { row: 0, column: 2, value: { kind: "error", value: "#DIV/0!" }, formula: "=1/0", cachedResult: { kind: "error", value: "#DIV/0!" } },
    { row: 1, column: 0, value: { kind: "number", value: 1 }, formula: "={1,2}", formulaGroup: "array" },
    { row: 1, column: 1, value: { kind: "number", value: 2 }, formulaGroup: "array" }
  ], formulaGroups: [{ id: "array", kind: "array", expression: "={1,2}", range: { startRow: 1, endRow: 1, startColumn: 0, endColumn: 1 } }] }] };
  const bytes = await createOdfWriter("extended")(original, [], context), xml = (await unpackOdf(bytes)).parts.get("content.xml")!;
  expect(xml).toContain('office:date-value="1904-01-02T12:00:00"');
  expect(xml).toContain('office:time-value="PT025H00M00S"');
  expect(xml).toContain('table:number-matrix-columns-spanned="2"');
  const round = await readOdf(bytes, context);
  expect(round.sheets[0]!.cells[0]!.value).toEqual(original.sheets[0]!.cells[0]!.value);
  expect(round.sheets[0]!.cells[1]!.value).toEqual(original.sheets[0]!.cells[1]!.value);
  // The released saver serializes formula error caches as strings in both profiles.
  // oo_cell_start takes office:string-value verbatim; recalculation restores error type.
  expect(round.sheets[0]!.cells[2]).toMatchObject({ formula: "=1/0", cachedResult: { kind: "string", value: "#DIV/0!" } });
  expect(original.sheets[0]!.cells[2]!.cachedResult!.kind).toBe("error");
  expect(round.sheets[0]!.formulaGroups?.[0]!.range).toEqual(original.sheets[0]!.formulaGroups![0]!.range);
});

it("exports original Gnumeric style regions on blank cells, validations and conditional overlays", async () => {
  const source = `<g:Workbook xmlns:g="http://www.gnumeric.org/v10.dtd"><g:Sheets><g:Sheet><g:Name>S</g:Name><g:Styles>
    <g:StyleRegion startRow="0" endRow="1" startCol="0" endCol="1"><g:Style Format="0.00"><g:Font Bold="1">Sans</g:Font>
      <g:Validation Type="GNM_VALIDATION_TYPE_AS_INT" Operator="GNM_VALIDATION_OP_BETWEEN" Style="GNM_VALIDATION_STYLE_STOP" AllowBlank="1" UseDropdown="0"><g:Expression0>1</g:Expression0><g:Expression1>10</g:Expression1></g:Validation>
      <g:Condition Operator="4"><g:Expression0>5</g:Expression0><g:Style Fore="FFFF:0000:0000"/></g:Condition>
    </g:Style></g:StyleRegion></g:Styles><g:Cells><g:Cell Row="0" Col="0" ValueType="40">3</g:Cell></g:Cells></g:Sheet></g:Sheets></g:Workbook>`;
  const original = await readGnumeric(new TextEncoder().encode(source), context);
  const { parts } = await unpackOdf(await createOdfWriter("strict")(original, [], context));
  const xml = parts.get("content.xml")!;
  expect(xml).toContain('table:condition="of:cell-content-is-whole-number() and cell-content-is-between(1;10)"');
  expect(xml).toContain('style:condition="of:cell-content()&gt;5"');
  const round = await readOdf(await createOdfWriter("strict")(original, [], context), context);
  const blankStyle = round.sheets[0]!.unsupportedRecords?.find(r => r.kind === "table-cell" && r.data && typeof r.data === "object" && !Array.isArray(r.data) && "row" in r.data && r.data.row === 1);
  expect(blankStyle?.data).toMatchObject({ row: 1, column: 0, rows: 1, columns: 2 });
  expect(round.sheets[0]!.cells[0]!.format).toBe("0.00");
});

it.each(["strict", "extended"] as const)("reports unexported original object records before %s publication", async profile => {
  const events: string[] = [], input: Workbook = { sheets: [{ id: "s", name: "S", cells: [], unsupportedRecords: [
    { source: "Gnumeric_XmlIO:sax", kind: "Objects", disposition: "retained", data: { name: "Objects", namespace: "http://www.gnumeric.org/v10.dtd", children: [
      { name: "SheetObjectGraph", namespace: "http://www.gnumeric.org/v10.dtd", attributes: [], children: [] }
    ] } }
  ] }] };
  const bytes = await createOdfWriter(profile)(input, [], { ...context, async diagnostic(d) { events.push(d.message); } });
  events.push("artifact");
  expect(events).toEqual([`ODF ${profile} writer does not export sheet 'S' object 'SheetObjectGraph'\n`, "artifact"]);
  expect((await unpackOdf(bytes)).parts.get("content.xml")).not.toContain("draw:object");
});

it.each(["strict", "extended"] as const)("exports sheet display flags under the native %s namespace policy", async profile => {
  const input: Workbook = { sheets: [{ id: "s", name: "S", cells: [], view: { gnumeric: { DisplayFormulas: "1", HideColHeader: "1", HideRowHeader: "0", RTL_Layout: "1" } } }] };
  const bytes = await createOdfWriter(profile)(input, [], context), xml = (await unpackOdf(bytes)).parts.get("content.xml")!;
  expect(xml).toContain('style:writing-mode="rl-tb"');
  expect(xml.includes('gnm:display-formulas="true"')).toBe(profile === "extended");
  expect(xml.includes('gnm:display-col-header="false"')).toBe(profile === "extended");
  const round = await readOdf(bytes, context);
  if (profile === "extended") expect(round.sheets[0]!.view?.gnumeric).toMatchObject({ DisplayFormulas: "1", HideColHeader: "1", HideRowHeader: "0", RTL_Layout: "1" });
});
