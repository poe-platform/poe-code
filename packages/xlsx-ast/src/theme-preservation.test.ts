import { expect, it } from "vitest";
import type { CapabilityContext } from "@poe-code/spreadsheet-engine/contracts";
import type { ImportedValue, UnsupportedRecord, Workbook } from "@poe-code/spreadsheet-ast";
import { metadataNode } from "@poe-code/spreadsheet-engine/codecs/xlsx-write-support";
import { createXlsxWriter, readXlsx } from "./xlsx.js";
const context: CapabilityContext = { signal: new AbortController().signal, own() {},
  environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 1000000, outputBytes: 1000000, cells: 100, sheets: 2, operations: 100000 } };
const namespace = "http://schemas.openxmlformats.org/drawingml/2006/main";
const node = (name: string, attributes: Record<string, string> = {}, children: ImportedValue[] = []): ImportedValue =>
  ({ name, namespace, attributes, children, text: "" });
const theme: UnsupportedRecord = { source: "xl/theme/theme1.xml", kind: "theme", disposition: "retained", data: node("theme", { name: 'Custom & "Theme"' }, [
  node("themeElements", {}, [node("clrScheme", { name: "Colors" }, [node("accent1", {}, [node("srgbClr", { val: "123456" })])]),
    node("fontScheme", { name: "Fonts" }, [node("majorFont", {}, [node("latin", { typeface: "Cambria" })]), node("minorFont", {}, [node("latin", { typeface: "Calibri" })])]),
    node("fmtScheme", { name: "Effects" })])]) };
for (const edition of ["2006", "2008"] as const) it(`${edition} preserves a self-contained DrawingML theme and edits`, async () => {
  const diagnostics: string[] = [];
  const ctx = { ...context, diagnostic: async (item: { message: string }) => { diagnostics.push(item.message); } };
  const book: Workbook = { sheets: [{ id: "s", name: "Data", cells: [] }], unsupportedRecords: [theme] };
  const imported = await readXlsx(await createXlsxWriter(edition)(book, [], ctx), ctx);
  expect(diagnostics).toEqual([]);
  const retained = imported.unsupportedRecords!.find(record => record.kind === "theme")!;
  expect(metadataNode(retained.data)).toEqual(metadataNode(theme.data));
  const source = retained.data as Record<string, ImportedValue>;
  const edited = { ...imported, unsupportedRecords: [{ ...retained, data: { ...source, attributes: { name: "Edited" } } }] };
  const result = await readXlsx(await createXlsxWriter(edition)(edited, [], ctx), ctx);
  expect(metadataNode(result.unsupportedRecords!.find(record => record.kind === "theme")!.data)?.attributes.name).toBe("Edited");
  expect(diagnostics).toEqual([]);
});
it("retains loss warnings for unavailable relationships, foreign nodes and duplicate themes", async () => {
  for (const data of [node("theme", { xmlns: "urn:foreign" }), node("theme", {}, [node("blip", { "r:embed": "rId1" })]),
    { name: "theme", namespace: "urn:foreign", attributes: {}, children: [], text: "" },
    node("theme", {}, [{ name: "foreign", namespace: "urn:foreign", attributes: {}, children: [], text: "" }])]) {
    const diagnostics: string[] = [];
    await createXlsxWriter("2006")({ sheets: [{ id: "s", name: "Data", cells: [] }], unsupportedRecords: [{ ...theme, data }] }, [],
      { ...context, diagnostic: async item => { diagnostics.push(item.message); } });
    expect(diagnostics).toHaveLength(1);
  }
  const diagnostics: string[] = [];
  await createXlsxWriter("2006")({ sheets: [{ id: "s", name: "Data", cells: [] }], unsupportedRecords: [theme, { ...theme }] }, [],
    { ...context, diagnostic: async item => { diagnostics.push(item.message); } });
  expect(diagnostics).toHaveLength(1);
});
