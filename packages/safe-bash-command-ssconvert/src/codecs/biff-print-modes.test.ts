import { expect, it } from "vitest";
import type { CapabilityContext } from "../contracts.js";
import type { Workbook } from "../workbook.js";
import { Binary, readBiffRecords } from "./biff-binary.js";
import { biffNode, readBiffMetadata } from "./biff-metadata.js";
import { words } from "./biff-write-binary.js";
import { readBiff } from "./biff.js";
import { writeBiffStream } from "./biff-write.js";
import { metadataNode } from "./xlsx-write-support.js";
const context: CapabilityContext = { signal: new AbortController().signal, own() {},
  environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 100000, outputBytes: 100000, cells: 100, sheets: 4, operations: 1000 } };
for (const [placement, noteBits] of [["NONE", 0], ["IN_PLACE", 0x20], ["AT_END", 0x220]] as const) {
  for (const [errors, errorBits] of [["DISPLAYED", 0], ["BLANK", 0x400], ["DASHES", 0x800], ["NA", 0xc00]] as const) {
    for (const revision of [7, 8] as const) it(`exports BIFF${revision} print comments ${placement} and errors ${errors}`, async () => {
      const source: Workbook = { sheets: [{ id: "s", name: "Sheet1", cells: [], unsupportedRecords: [
        { source: "Gnumeric_XmlIO:sax", kind: "PrintInformation", disposition: "retained", data: biffNode("PrintInformation", {}, "", [
          biffNode("comments", { placement: "GNM_PRINT_COMMENTS_" + placement }),
          biffNode("errors", { PrintErrorsAs: "GNM_PRINT_ERRORS_AS_" + errors })
        ]) }
      ] }] };
      const warnings: string[] = [];
      const bytes = await writeBiffStream(source, revision, false, { ...context, async diagnostic(d) { warnings.push(d.message); } });
      const flags = readBiffRecords(bytes, context).find(r => r.opcode === 0xa1)!.data.u16(10);
      expect(flags & 0xe20).toBe(revision === 8 ? noteBits | errorBits : noteBits & 0x20);
      const printed = metadataNode((await readBiff(bytes, context)).sheets[0]!.unsupportedRecords?.find(r => r.kind === "PrintInformation")?.data)!;
      expect(printed.children.find(n => n.name === "comments")?.attributes.placement).toBe("GNM_PRINT_COMMENTS_" +
        (revision === 7 && placement === "AT_END" ? "IN_PLACE" : placement));
      expect(printed.children.find(n => n.name === "errors")?.attributes.PrintErrorsAs).toBe("GNM_PRINT_ERRORS_AS_" +
        (revision === 7 ? "DISPLAYED" : errors));
      expect(warnings).toEqual(revision === 8 ? [] : [
        ...(placement === "AT_END" ? ["Excel BIFF7 cannot print comments at the end; using in-place comments"] : []),
        ...(errors !== "DISPLAYED" ? ["Excel BIFF7 cannot change printed error values; using displayed errors"] : [])
      ]);
    });
  }
}
it("does not interpret BIFF8-only print bits in BIFF7 input", () => {
  const bytes = new Uint8Array(34); bytes.set(words(9, 100, 1, 1, 1, 0xe22));
  const metadata = readBiffMetadata([{ opcode: 0xa1, offset: 0, data: new Binary(bytes) }], 7, 1252, context);
  const printed = metadataNode(metadata.records.find(r => r.kind === "PrintInformation")?.data)!;
  expect(printed.children.find(n => n.name === "comments")?.attributes.placement).toBe("GNM_PRINT_COMMENTS_IN_PLACE");
  expect(printed.children.find(n => n.name === "errors")?.attributes.PrintErrorsAs).toBe("GNM_PRINT_ERRORS_AS_DISPLAYED");
});
