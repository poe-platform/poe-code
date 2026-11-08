import { expect, it } from "vitest";
import type { CapabilityContext } from "@poe-code/spreadsheet-engine/contracts";
import { metadataNode } from "@poe-code/spreadsheet-engine/codecs/xlsx-write-support";
import { Binary } from "./biff-binary.js";
import { biffNode, readBiffMetadata } from "./biff-metadata.js";
import { createBiffWriter, readBiff } from "./biff.js";
const context: CapabilityContext = { signal: new AbortController().signal, own() {}, environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 100000, outputBytes: 100000, cells: 100, sheets: 2, operations: 10000 } };
for (const revision of [4, 7, 8]) for (const enabled of [false, true]) it(`imports BIFF${revision} first-page enable ${enabled}`, () => {
  const bytes = new Uint8Array(revision === 4 ? 12 : 34), view = new DataView(bytes.buffer);view.setUint16(4, 42, true);view.setUint16(10, enabled ? 0x80 : 0, true);
  const print = metadataNode(readBiffMetadata([{ opcode: 0xa1, offset: 0, data: new Binary(bytes) }], revision, 1252, context).records.find(record => record.kind === "PrintInformation")!.data)!;
  expect(print.children.find(node => node.name === "first_page_number")?.attributes.value).toBe("42");
  expect(print.children.find(node => node.name === "use_first_page_number")?.attributes.value).toBe(revision === 4 || enabled ? "1" : "0");
});
for (const enabled of [0, 1]) it(`preserves explicit first-page enable ${enabled} in BIFF7/8`, async () => {
  for (const revision of [7, 8] as const) {
    const records = [{ source: "Gnumeric_XmlIO:sax", kind: "PrintInformation", disposition: "retained" as const,
      data: biffNode("PrintInformation", {}, "", [biffNode("first_page_number", { value: 42 }), biffNode("use_first_page_number", { value: enabled })]) }];
    const output = await readBiff(await createBiffWriter(revision)({ sheets: [{ id: "s", name: "Data", cells: [], unsupportedRecords: records }] }, [], context), context);
    const print = metadataNode(output.sheets[0]!.unsupportedRecords!.find(record => record.kind === "PrintInformation")!.data)!;
    expect(print.children.find(node => node.name === "first_page_number")?.attributes.value).toBe("42");
    expect(print.children.find(node => node.name === "use_first_page_number")?.attributes.value).toBe(String(enabled));
  }
});
