import { expect, it } from "vitest";
import type { CapabilityContext } from "@poe-code/spreadsheet-engine/contracts";
import { metadataNode } from "@poe-code/spreadsheet-engine/codecs/xlsx-write-support";
import { Binary } from "./biff-binary.js";
import { biffNode, readBiffMetadata } from "./biff-metadata.js";
import { createBiffWriter, readBiff } from "./biff.js";
const context: CapabilityContext = { signal: new AbortController().signal, own() {}, environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 100000, outputBytes: 100000, cells: 100, sheets: 2, operations: 10000 } };
for (const first of [0, 1, 42, 65535]) it(`retains native BIFF first page ${first}`, async () => {
  for (const revision of [4, 7, 8]) {
    const bytes = new Uint8Array(revision === 4 ? 12 : 34), view = new DataView(bytes.buffer);
    view.setUint16(0, 9, true); view.setUint16(2, 100, true); view.setUint16(4, first, true);
    const records = readBiffMetadata([{ opcode: 0xa1, offset: 0, data: new Binary(bytes) }], revision, 1252, context).records;
    expect(metadataNode(records.find(record => record.kind === "PrintInformation")!.data)!.children.find(node => node.name === "first_page_number")?.attributes.value).toBe(String(first));
    for (const target of [7, 8] as const) {
      const output = await readBiff(await createBiffWriter(target)({ sheets: [{ id: "s", name: "Data", cells: [], unsupportedRecords: records }] }, [], context), context);
      const print = metadataNode(output.sheets[0]!.unsupportedRecords!.find(record => record.kind === "PrintInformation")!.data)!;
      expect(print.children.find(node => node.name === "first_page_number")?.attributes.value).toBe(String(first));
    }
  }
});
it("refuses nonrepresentable first page numbers instead of wrapping", async () => {
  for (const first of [-2, 1.5, 65536, Number.NaN]) {
    const book = { sheets: [{ id: "s", name: "Data", cells: [], unsupportedRecords: [{ source: "Gnumeric_XmlIO:sax", kind: "PrintInformation", disposition: "retained" as const,
      data: biffNode("PrintInformation", {}, "", [biffNode("first_page_number", { value: first })]) }] }] };
    await expect(createBiffWriter(8)(book, [], context)).rejects.toThrow("first page");
  }
});
it("ignores invalid SETUP page data while preserving an earlier valid page", () => {
  const valid = new Uint8Array(34), invalid = new Uint8Array(34);
  new DataView(valid.buffer).setUint16(4, 42, true);
  new DataView(invalid.buffer).setUint16(4, 7, true); new DataView(invalid.buffer).setUint16(10, 4, true);
  const records = readBiffMetadata([{ opcode: 0xa1, offset: 0, data: new Binary(valid) }, { opcode: 0xa1, offset: 38, data: new Binary(invalid) }], 8, 1252, context).records;
  expect(metadataNode(records.find(record => record.kind === "PrintInformation")!.data)!.children.find(node => node.name === "first_page_number")?.attributes.value).toBe("42");
});
