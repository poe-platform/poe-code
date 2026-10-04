import { expect, it } from "vitest";
import type { CapabilityContext } from "../../contracts.js";
import type { ImportedValue } from "@poe-code/spreadsheet-ast";
import { sheetPrintSettings } from "./settings.js";
const context: CapabilityContext = { signal: new AbortController().signal, own() {}, environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 100000, outputBytes: 100000, cells: 100, sheets: 2, operations: 10000 } };
const node = (name: string, value: number): ImportedValue => ({ name, namespace: "http://www.gnumeric.org/v10.dtd", attributes: [{ name: "value", namespace: "", value: String(value) }], text: "", children: [] });
const sheet = (children: ImportedValue[]) => ({ id: "s", name: "Data", cells: [], unsupportedRecords: [{ source: "Gnumeric_XmlIO:sax", kind: "PrintInformation", disposition: "retained" as const,
  data: { name: "PrintInformation", namespace: "http://www.gnumeric.org/v10.dtd", attributes: [], text: "", children } }] });
for (const copies of [0, 1, 2, 65535]) it(`accepts print copies ${copies} without repeating PDF pages`, () => {
  expect(sheetPrintSettings(sheet([node("copies", copies)]), context).firstPageNumber).toBeUndefined();
});
for (const enabled of [0, 1]) for (const reverse of [false, true]) it(`honors first-page enable ${enabled} regardless of node order ${reverse}`, () => {
  const children = [node("first_page_number", 42), node("use_first_page_number", enabled)];
  expect(sheetPrintSettings(sheet(reverse ? children.reverse() : children), context).firstPageNumber).toBe(enabled ? 42 : undefined);
});
it("rejects invalid print-copy metadata", () => {
  expect(() => sheetPrintSettings(sheet([node("copies", -1)]), context)).toThrow("copies");
});
it("accepts the native no-printed-comments setting", () => {
  const comments: ImportedValue = { name: "comments", namespace: "http://www.gnumeric.org/v10.dtd", attributes: [{ name: "placement", namespace: "", value: "GNM_PRINT_COMMENTS_NONE" }], text: "", children: [] };
  expect(() => sheetPrintSettings(sheet([comments]), context)).not.toThrow();
});
it("still rejects unimplemented end-of-document comments", () => {
  const comments: ImportedValue = { name: "comments", namespace: "http://www.gnumeric.org/v10.dtd", attributes: [{ name: "placement", namespace: "", value: "GNM_PRINT_COMMENTS_AT_END" }], text: "", children: [] };
  expect(() => sheetPrintSettings(sheet([comments]), context)).toThrow("comments");
});

it("treats the native automatic first-page sentinel as automatic numbering", () => {
  expect(sheetPrintSettings(sheet([node("first_page_number", -1)]), context).firstPageNumber).toBeUndefined();
});
it("rejects an automatic sentinel combined with explicit manual numbering", () => {
  expect(() => sheetPrintSettings(sheet([node("first_page_number", -1), node("use_first_page_number", 1)]), context)).toThrow("first page number");
});
