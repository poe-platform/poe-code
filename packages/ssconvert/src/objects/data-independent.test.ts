import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";
import { readGnumeric } from "../codecs/gnumeric.js";
import { renameWorkbookSheet } from "../formulas/workbook.js";
import { sheetObjects } from "./index.js";
import type { CapabilityContext } from "../contracts.js";

const context: CapabilityContext = { signal: new AbortController().signal, own() {}, environment: { env: {}, locale: "C", timezone: "UTC" }, limits: { inputBytes: 100000, outputBytes: 100000, cells: 100, sheets: 4, operations: 1000 } };
const workbook = (objects: string) => new TextEncoder().encode(`<g:Workbook xmlns:g="http://www.gnumeric.org/v10.dtd" xmlns:e="urn:independent"><g:Sheets><g:Sheet><g:Name>S</g:Name><g:Objects>${objects}</g:Objects><g:Cells/></g:Sheet></g:Sheets></g:Workbook>`);
const dimension = '<dimension type="GnmGODataScalar">S!$A$1</dimension>';

const passiveNode = (name: string, namespace: string, children: import("../workbook.js").ImportedValue[] = []): import("../workbook.js").ImportedValue => ({ name, namespace, text: "", attributes: [], children });
const linkedDimension = (): import("../workbook.js").ImportedValue => ({ name: "dimension", namespace: "", text: "S!$A$1", attributes: [{ name: "type", namespace: "", value: "GnmGODataScalar" }], children: [] });
const graphNamespace = "http://www.gnumeric.org/v10.dtd";
it.each([
  passiveNode("SheetObjectGraph", graphNamespace, [passiveNode("GogObject", "", [passiveNode("data", "urn:independent", [linkedDimension()])])]),
  passiveNode("SheetObjectImage", graphNamespace, [passiveNode("data", "", [linkedDimension()])]),
  passiveNode("SheetObjectGraph", graphNamespace, [passiveNode("GogObject", "urn:independent", [passiveNode("data", "", [linkedDimension()])])]),
  passiveNode("SheetObjectGraph", graphNamespace, [passiveNode("GogObject", "", [passiveNode("property", "", [passiveNode("data", "", [linkedDimension()])])])])
])("leaves SDK foreign or non-graph dimension lookalikes passive: %j", async object => {
  const imported = await readGnumeric(workbook(""), context);
  const book = { ...imported, sheets: imported.sheets.map(sheet => ({ ...sheet, unsupportedRecords: [{ source: "Gnumeric_XmlIO:sax", kind: "Objects", disposition: "retained" as const, data: passiveNode("Objects", graphNamespace, [object]) }] })) };
  const renamed = renameWorkbookSheet(book, book.sheets[0]!.id, "T", context);
  const output = JSON.stringify(renamed.sheets[0]!.unsupportedRecords);
  expect(output).toContain("S!$A$1");
  expect(output).not.toContain("'T'!$A$1");
});

it("keeps unknown, abstract, literal and qualified types passive while rewriting nested graph links", async () => {
  const book = await readGnumeric(workbook(`<g:SheetObjectGraph><GogObject><GogObject role="Plot"><data><dimension type="GODataScalar">S!$A$1</dimension><dimension type="GODataScalarStr">S!$A$1</dimension><dimension type="UnregisteredType">S!$A$1</dimension><dimension e:type="GnmGODataScalar">S!$A$1</dimension>${dimension}</data></GogObject></GogObject></g:SheetObjectGraph>`), context);
  const renamed = renameWorkbookSheet(book, book.sheets[0]!.id, "T", context);
  const data = sheetObjects(renamed.sheets[0]!, context)[0]!.graph!.children[0]!.data;
  expect(data.map(item => [item.storage, item.serialized])).toEqual([["unknown", "S!$A$1"], ["literal", "S!$A$1"], ["unknown", "S!$A$1"], ["unknown", "S!$A$1"], ["expression", "'T'!$A$1"]]);
});

it("observes cancellation identity and bounded rewrite work without mutating the input", async () => {
  const book = await readGnumeric(workbook(`<g:SheetObjectGraph><GogObject><data>${dimension}</data></GogObject></g:SheetObjectGraph>`), context);
  const original = JSON.stringify(book);
  const controller = new AbortController(), reason = { cancelled: true };
  controller.abort(reason);
  try {
    renameWorkbookSheet(book, book.sheets[0]!.id, "T", { ...context, signal: controller.signal });
    throw new Error("cancellation was ignored");
  } catch (error) { expect(error).toBe(reason); }
  expect(() => renameWorkbookSheet(book, book.sheets[0]!.id, "T", { ...context, limits: { ...context.limits, workbookWork: 1 } })).toThrow();
  expect(JSON.stringify(book)).toBe(original);
});

it("projects only unqualified paint components and keeps qualified attributes passive", async () => {
  const imported = await readGnumeric(workbook(""), context);
  const paint = { name: "Style", namespace: "", text: "", attributes: [{ name: "type", namespace: "", value: "GOStyle" }], children: [
    { name: "font", namespace: "urn:independent", text: "", attributes: [{ name: "font", namespace: "", value: "Foreign font" }], children: [] },
    { name: "line", namespace: "", text: "", attributes: [{ name: "color", namespace: "urn:independent", value: "foreign-color" }, { name: "width", namespace: "", value: "2" }], children: [] },
    { name: "fill", namespace: "", text: "", attributes: [{ name: "type", namespace: "", value: "image" }], children: [{ name: "image", namespace: "", text: "", attributes: [{ name: "uri", namespace: "", value: "file:///never-read" }], children: [] }, { name: "gradient", namespace: "urn:independent", text: "", attributes: [], children: [] }] }
  ] };
  const sheet = { ...imported.sheets[0]!, unsupportedRecords: [{ source: "Gnumeric_XmlIO:sax", kind: "Objects", disposition: "retained" as const, data: passiveNode("Objects", graphNamespace, [passiveNode("SheetObjectFilled", graphNamespace, [paint])]) }] };
  const objects = sheetObjects(sheet, context);
  expect(objects[0]!.style).toEqual({ type: "GOStyle", line: { width: "2" }, fill: { attributes: { type: "image" }, image: { uri: "file:///never-read" } } });
  expect(objects[0]!.payload.children[0]!.children[1]!.qualifiedAttributes).toEqual([{ name: "color", namespace: "urn:independent", value: "foreign-color" }]);
  expect(() => sheetObjects(sheet, { ...context, limits: { ...context.limits, workbookWork: 20 } })).toThrow("work limit");
});

it("ignores foreign Style nodes and wrong chart property types", async () => {
  const imported = await readGnumeric(workbook(""), context);
  const property = { name: "property", namespace: "", text: "", attributes: [{ name: "name", namespace: "", value: "style" }, { name: "type", namespace: "", value: "ExternalScript" }], children: [] };
  const sheet = { ...imported.sheets[0]!, unsupportedRecords: [{ source: "Gnumeric_XmlIO:sax", kind: "Objects", disposition: "retained" as const, data: passiveNode("Objects", graphNamespace, [passiveNode("SheetObjectFilled", graphNamespace, [passiveNode("Style", "urn:independent")]), passiveNode("SheetObjectGraph", graphNamespace, [passiveNode("GogObject", "", [property])])]) }] };
  const objects = sheetObjects(sheet, context);
  expect(objects[0]!.style).toBeUndefined();
  expect(objects[1]!.graph!.style).toBeUndefined();
  expect(objects[1]!.graph!.properties[0]!.attributes.type).toBe("ExternalScript");
});


it("projects cross-realm records but exposes the existing workbook ownership rejection", async () => {
  const imported = await readGnumeric(workbook(""), context);
  const data = runInNewContext("(" + JSON.stringify(passiveNode("Objects", graphNamespace, [passiveNode("SheetObjectGraph", graphNamespace, [passiveNode("GogObject", "", [passiveNode("data", "", [linkedDimension()])])])])) + ")") as import("../workbook.js").ImportedValue;
  const sheet = { ...imported.sheets[0]!, unsupportedRecords: [{ source: "Gnumeric_XmlIO:sax", kind: "Objects", disposition: "retained" as const, data }] };
  expect(sheetObjects(sheet, context)[0]!.graph!.data[0]!.expression).toBe("S!$A$1");
  expect(() => renameWorkbookSheet({ ...imported, sheets: [sheet] }, sheet.id, "T", context)).toThrow("Unsupported workbook prototype");
});
