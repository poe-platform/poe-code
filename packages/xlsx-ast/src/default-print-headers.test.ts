import { expect, it } from "vitest";
import { metadataNode } from "@poe-code/spreadsheet-engine/codecs/xlsx-write-support";
import type { MetadataNode as SourceNode } from "@poe-code/spreadsheet-engine/codecs/xlsx-write-support";
import { readXlsxMetadata } from "./xlsx-metadata.js";
const node = (name: string, children: SourceNode[] = [], text = ""): SourceNode => ({ name,
  namespace: "http://schemas.openxmlformats.org/spreadsheetml/2006/main", attributes: {}, children, text });
it.each([
  [],
  [node("pageMargins")],
  [node("headerFooter")],
  [node("headerFooter", [node("oddHeader")])]
].map(children => ({children})))("imports omitted XLSX print headers as blank: %j", ({children}) => {
  const records = readXlsxMetadata(node("worksheet", children));
  const print = metadataNode(records.find(record => record.kind === "PrintInformation")?.data ?? null);
  expect(print?.children.filter(child => child.name === "Header" || child.name === "Footer").map(child => [child.name, child.attributes])).toEqual([
    ["Header", {Left: "", Middle: "", Right: ""}], ["Footer", {Left: "", Middle: "", Right: ""}]
  ]);
});
it("retains an explicit header while defaulting only the missing footer", () => {
  const records = readXlsxMetadata(node("worksheet", [node("headerFooter", [node("oddHeader", [], "&LReport&C&A&R&P")])]));
  const print = metadataNode(records.find(record => record.kind === "PrintInformation")!.data)!;
  expect(print.children.find(child => child.name === "Header")?.attributes).toEqual({Left: "Report", Middle: "&[TAB]", Right: "&[PAGE]"});
  expect(print.children.find(child => child.name === "Footer")?.attributes).toEqual({Left: "", Middle: "", Right: ""});
});
