import { expect, it } from "vitest";
import { readGnumeric, writeGnumeric } from "../codecs/gnumeric.js";
import type { CapabilityContext } from "../contracts.js";
const context: CapabilityContext = { signal: new AbortController().signal, own() {}, environment: { env: {}, locale: "C", timezone: "UTC" }, limits: { inputBytes: 100000, outputBytes: 100000, cells: 100, sheets: 2, operations: 1000 } };
it("retains historical drawing classes accepted by the released XML reader", async () => {
  const source = '<g:Workbook xmlns:g="http://www.gnumeric.org/v10.dtd"><g:Sheets><g:Sheet><g:Name>S</g:Name><g:Objects><g:SheetObjectFilled ObjectBound="A1:B2" Label="original"/></g:Objects><g:Cells/></g:Sheet></g:Sheets></g:Workbook>';
  const book = await readGnumeric(new TextEncoder().encode(source), context);
  const output = new TextDecoder().decode(await writeGnumeric(book, [], context));
  expect(output).toContain('Label="original"');
});

import { sheetObjects } from "./index.js";
it("preserves qualified object attributes without treating them as unqualified names", async () => {
  const source = '<g:Workbook xmlns:g="http://www.gnumeric.org/v10.dtd" xmlns:q="urn:original"><g:Sheets><g:Sheet><g:Name>S</g:Name><g:Objects><g:SheetObjectImage Name="Image" q:Name="Qualified" xml:lang="en" ObjectBound="A1:B2"/></g:Objects><g:Cells/></g:Sheet></g:Sheets></g:Workbook>';
  const book = await readGnumeric(new TextEncoder().encode(source), context);
  const object = sheetObjects(book.sheets[0]!, context)[0]!;
  expect(object.name).toBe("Image");
  expect(object.payload.qualifiedAttributes).toContainEqual({ name: "Name", namespace: "urn:original", value: "Qualified" });
  expect(object.payload.qualifiedAttributes).toContainEqual({ name: "lang", namespace: "http://www.w3.org/XML/1998/namespace", value: "en" });
});
it("projects graph links and anchor geometry separately from embedded images", async () => {
  const source = '<g:Workbook xmlns:g="http://www.gnumeric.org/v10.dtd"><g:Sheets><g:Sheet><g:Name>S</g:Name><g:Objects><g:SheetObjectGraph ObjectBound="B2:D5" ObjectOffset="0 0 1 1" Name="Plot"><GogObject type="GogGraph"><GogObject role="Chart" type="GogChart"><GogObject role="Plot" type="GogXYPlot"><GogObject role="Series" type="GogXYSeries"><data><dimension id="1" type="GnmGODataVector">S!$A$1:$A$2</dimension></data></GogObject></GogObject></GogObject></GogObject></g:SheetObjectGraph><g:SheetObjectImage ObjectBound="A1:A2"/></g:Objects><g:Cells/></g:Sheet></g:Sheets></g:Workbook>';
  const book = await readGnumeric(new TextEncoder().encode(source), context);
  const objects = sheetObjects(book.sheets[0]!, context);
  expect(objects.map(object => object.kind)).toEqual(["graph", "image"]);
  expect(objects[0]).toMatchObject({ name: "Plot", zOrder: 0, anchor: { range: { startRow: 1, startColumn: 1, endRow: 4, endColumn: 3 } }, graph: { type: "GogGraph" } });
  expect(objects[0]!.graph!.children[0]!.children[0]!.children[0]!.data).toEqual([{ id: "1", type: "GnmGODataVector", serialized: "S!$A$1:$A$2", storage: "expression", expression: "S!$A$1:$A$2" }]);
});

import { Volume } from "memfs";
import { createEngine } from "../engine.js";
import { renameWorkbookSheet } from "../formulas/workbook.js";
it("round trips rewritten chart dimensions using the actual engine and injected memfs bytes", async () => {
  const volume = new Volume();
  volume.writeFileSync("/in.xml", '<g:Workbook xmlns:g="http://www.gnumeric.org/v10.dtd"><g:Sheets><g:Sheet><g:Name>S</g:Name><g:Objects><g:SheetObjectGraph Name="Original" ObjectBound="A1:B2"><GogObject type="GogGraph"><data><dimension id="0" type="GnmGODataScalar">S!$A$1</dimension></data></GogObject></g:SheetObjectGraph></g:Objects><g:Cells><g:Cell Row="0" Col="0" ValueType="40">2</g:Cell></g:Cells></g:Sheet></g:Sheets></g:Workbook>');
  const engine = createEngine({ codecs: [], environment: context.environment, limits: context.limits,
    filesystem: { async read(uri, signal) { signal.throwIfAborted(); return [new Uint8Array(volume.readFileSync(uri) as Uint8Array)]; },
      async write(uri, bytes, signal) { signal.throwIfAborted(); volume.writeFileSync(uri, bytes); } } });
  try {
    const book = await engine.readWorkbook({ kind: "resource", uri: "/in.xml" }, {}, context);
    const renamed = renameWorkbookSheet(book, book.sheets[0]!.id, "Renamed", context);
    expect(sheetObjects(renamed.sheets[0]!, context)[0]!.graph!.data[0]!.expression).toBe("'Renamed'!$A$1");
    await expect(engine.writeWorkbook(renamed, { kind: "resource", uri: "/out.xml" }, { exportType: "Gnumeric_XmlIO:sax:0" }, context)).rejects.toThrow("Workbook belongs to another engine");
    expect(volume.existsSync("/out.xml")).toBe(false);
    volume.writeFileSync("/renamed.xml", await writeGnumeric(renamed, [], context));
    const owned = await engine.readWorkbook({ kind: "resource", uri: "/renamed.xml" }, {}, context);
    const expected = sheetObjects(renamed.sheets[0]!, context)[0]!;
    expect(sheetObjects(owned.sheets[0]!, context)[0]).toMatchObject({ graph: expected.graph, anchor: expected.anchor, name: expected.name, zOrder: expected.zOrder });
    const result = await engine.writeWorkbook(owned, { kind: "resource", uri: "/out.xml" }, { exportType: "Gnumeric_XmlIO:sax:0" }, context);
    expect(result.exitCode).toBe(0);
    const round = await engine.readWorkbook({ kind: "resource", uri: "/out.xml" }, {}, context);
    expect(sheetObjects(round.sheets[0]!, context)).toEqual(sheetObjects(owned.sheets[0]!, context));
  } finally { await engine.dispose(); }
});

import type { ImportedValue, Sheet } from "../workbook.js";
it("bounds nested object traversal and observes cancellation before projection", () => {
  let data: ImportedValue = { name: "SheetObjectImage", namespace: "http://www.gnumeric.org/v10.dtd", text: "", attributes: [], children: [] };
  for (let depth = 0; depth < 130; depth++) data = { name: "Objects", namespace: "http://www.gnumeric.org/v10.dtd", text: "", attributes: [], children: [data] };
  const sheet: Sheet = { id: "S", name: "S", cells: [], unsupportedRecords: [{ source: "Gnumeric_XmlIO:sax", kind: "Objects", disposition: "retained", data }] };
  expect(() => sheetObjects(sheet, context)).toThrow("ssconvert object depth limit exceeded");
  expect(() => sheetObjects(sheet, { ...context, limits: { ...context.limits, workbookWork: 5 } })).toThrow("ssconvert workbook work limit exceeded");
  const controller = new AbortController();
  const reason = new Error("original cancellation");
  controller.abort(reason);
  try { sheetObjects(sheet, { ...context, signal: controller.signal }); throw new Error("missed cancellation"); }
  catch (error) { expect(error).toBe(reason); }
});

it("keeps source ordering and does not interpret foreign object or chart namespaces", async () => {
  const source = '<g:Workbook xmlns:g="http://www.gnumeric.org/v10.dtd" xmlns:q="urn:original"><g:Sheets><g:Sheet><g:Name>S</g:Name><g:Objects><g:SheetObjectGraph Name="First"><q:GogObject type="GogGraph"/></g:SheetObjectGraph><q:SheetObjectImage Name="Foreign"/><g:SheetWidgetCheckbox Name="Second"/><g:SheetObjectImage Name="Third" ObjectOffset="NaN 0 1 1"/></g:Objects><g:Cells/></g:Sheet></g:Sheets></g:Workbook>';
  const book = await readGnumeric(new TextEncoder().encode(source), context);
  const objects = sheetObjects(book.sheets[0]!, context);
  expect(objects.map(object => [object.kind, object.name, object.zOrder])).toEqual([["graph", "First", 0], ["control", "Second", 1], ["image", "Third", 2]]);
  expect(objects[0]!.graph).toBeUndefined();
  expect(objects[2]!.anchor.offsets).toEqual([]);
});

it("accepts XML whitespace separators in anchor offsets", async () => {
  const source = '<g:Workbook xmlns:g="http://www.gnumeric.org/v10.dtd"><g:Sheets><g:Sheet><g:Name>S</g:Name><g:Objects><g:SheetObjectImage ObjectBound="A1:B2" ObjectOffset="0&#9;0&#10;1&#13;1"/></g:Objects><g:Cells/></g:Sheet></g:Sheets></g:Workbook>';
  const book = await readGnumeric(new TextEncoder().encode(source), context);
  expect(sheetObjects(book.sheets[0]!, context)[0]!.anchor.offsets).toEqual([0, 0, 1, 1]);
});
