import { expect, it } from "vitest";
import type { CapabilityContext } from "@poe-code/spreadsheet-engine/contracts";
import { metadataNode } from "@poe-code/spreadsheet-engine/codecs/xlsx-write-support";
import { biffNode } from "./biff-metadata.js";
import { createBiffWriter, readBiff } from "./biff.js";
const context: CapabilityContext = { signal: new AbortController().signal, own() {}, environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 100000, outputBytes: 100000, cells: 100, sheets: 2, operations: 10000 } };
const book = (copies: number) => ({ sheets: [{ id: "s", name: "Data", cells: [], unsupportedRecords: [{ source: "Gnumeric_XmlIO:sax", kind: "PrintInformation", disposition: "retained" as const,
  data: biffNode("PrintInformation", {}, "", [biffNode("copies", { value: copies })]) }] }] });
for (const copies of [0, 1, 2, 65535]) it(`preserves ${copies} print copies through BIFF7/8`, async () => {
  for (const revision of [7, 8] as const) {
    const output = await readBiff(await createBiffWriter(revision)(book(copies), [], context), context);
    const print = metadataNode(output.sheets[0]!.unsupportedRecords!.find(record => record.kind === "PrintInformation")!.data)!;
    expect(print.children.find(node => node.name === "copies")?.attributes.value).toBe(String(copies));
  }
});
it("rejects nonrepresentable BIFF print-copy counts", async () => {
  for (const copies of [-1, 1.5, 65536, Number.NaN]) await expect(createBiffWriter(8)(book(copies), [], context)).rejects.toThrow("copies");
});
