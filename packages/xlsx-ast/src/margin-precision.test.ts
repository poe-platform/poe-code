import { expect, it } from "vitest";
import { metadataNode } from "@poe-code/spreadsheet-engine/codecs/xlsx-write-support";
import { readXlsxMetadata } from "./xlsx-metadata.js";
for (const inches of [0.123456789, 0.0000123456789, 1.23456789, 2.345678901234, 0, 0.7]) {
  it(`preserves full point precision for ${inches}-inch margins`, () => {
    const names = ["top", "bottom", "left", "right", "header", "footer"];
    const records = readXlsxMetadata({ name: "worksheet", namespace: "http://schemas.openxmlformats.org/spreadsheetml/2006/main", attributes: {}, text: "", children: [
      { name: "pageMargins", namespace: "http://schemas.openxmlformats.org/spreadsheetml/2006/main", attributes: Object.fromEntries(names.map(name => [name, String(inches)])), text: "", children: [] }
    ] });
    const print = metadataNode(records.find(record => record.kind === "PrintInformation")!.data)!;
    const margins = print.children.find(node => node.name === "Margins")!;
    for (const name of names) expect(Number(margins.children.find(node => node.name === name)!.attributes.Points), name).toBe(inches * 72);
  });
}
