import { expect, it } from "vitest";
import type { CapabilityContext } from "@poe-code/spreadsheet-engine/contracts";
import type { ImportedValue, UnsupportedRecord, Workbook } from "@poe-code/spreadsheet-ast";
import { metadataNode } from "@poe-code/spreadsheet-engine/codecs/xlsx-write-support";
import { createXlsxWriter, readXlsx } from "./xlsx.js";
const namespace = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const node = (name: string, attributes: Record<string, string> = {}, children: ImportedValue[] = [], text = ""): ImportedValue => ({ name, namespace, attributes, children, text });
const record = (kind: string, data: ImportedValue): UnsupportedRecord => ({ source: "xlsx", kind, disposition: "retained", data });
const context: CapabilityContext = { signal: new AbortController().signal, own() {}, environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 1000000, outputBytes: 1000000, cells: 100, sheets: 4, operations: 10000 } };
function input(id = "1"): Workbook {
  return { sheets: [{ id: "s", name: "Data", cells: [], unsupportedRecords: [record("conditionalFormatting", node("conditionalFormatting", { sqref: "A1:A5 C1:C5" }, [
    node("cfRule", { type: "cellIs", dxfId: id, priority: "7", stopIfTrue: "0", operator: "greaterThan" }, [node("formula", {}, [], "A1+1")])]))] }],
  unsupportedRecords: [record("dxfs", node("dxfs", { count: "2" }, [node("dxf", {}, [node("font", {}, [node("b", { val: "0" })])]),
    node("dxf", {}, [node("fill", {}, [node("patternFill", { patternType: "solid" }, [node("bgColor", { rgb: "FFFF0000" })])])])]))] };
}
for (const edition of ["2006", "2008"] as const) it(`retains conditional rules and differential indexes through ${edition} read/edit/export`, async () => {
  const diagnostics: string[] = [], ctx = { ...context, diagnostic: async (d: { message: string }) => { diagnostics.push(d.message); } };
  const original = input(), first = await readXlsx(await createXlsxWriter(edition)(original, [], ctx), ctx);
  const fills = first.unsupportedRecords?.find(r => r.kind === "dxfs");
  expect(metadataNode(fills?.data)).toEqual(metadataNode(original.unsupportedRecords![0]!.data));
  const rule = first.sheets[0]!.unsupportedRecords!.find(r => r.kind === "conditionalFormatting")!;
  expect(metadataNode(rule.data)).toEqual(metadataNode(original.sheets[0]!.unsupportedRecords![0]!.data));
  const data = metadataNode(rule.data)!;
  const edited = { ...first, sheets: [{ ...first.sheets[0]!, unsupportedRecords: [record("conditionalFormatting", node("conditionalFormatting", { ...data.attributes, sqref: "B2:B9" }, [node("cfRule", { ...data.children[0]!.attributes, dxfId: "0" }, [node("formula", {}, [], "B2+2")])]))] }] };
  const second = await readXlsx(await createXlsxWriter(edition)(edited, [], ctx), ctx);
  expect(metadataNode(second.sheets[0]!.unsupportedRecords!.find(r => r.kind === "conditionalFormatting")!.data)).toEqual(metadataNode(edited.sheets[0]!.unsupportedRecords[0]!.data));
  expect(diagnostics).toEqual([]);
});
for (const id of ["2", "-1", "1.5", "bad"]) it(`rejects dangling differential index ${id}`, async () => {
  await expect(createXlsxWriter("2008")(input(id), [], context)).rejects.toThrow("differential");
});

it("refuses foreign differential descendants instead of silently dropping them", async () => {
  const book = input();
  const changed = { ...book, unsupportedRecords: [record("dxfs", node("dxfs", {}, [node("dxf"), node("dxf", {}, [{ name: "extension", namespace: "urn:foreign", attributes: {}, children: [], text: "" }])]))] };
  await expect(createXlsxWriter("2008")(changed, [], context)).rejects.toThrow("differential style namespace");
});
it("preserves unrelated loss warnings beside retained conditional rules", async () => {
  const book = input(), diagnostics: string[] = [];
  const changed = { ...book, sheets: [{ ...book.sheets[0]!, unsupportedRecords: [...book.sheets[0]!.unsupportedRecords!, record("future", node("future"))] }] };
  await createXlsxWriter("2008")(changed, [], { ...context, diagnostic: async d => { diagnostics.push(d.message); } });
  expect(diagnostics).toEqual(["XLSX writer does not export sheet 'Data' record 'future'"]);
});
