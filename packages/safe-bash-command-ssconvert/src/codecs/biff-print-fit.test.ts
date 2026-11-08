import { expect, it } from "vitest";
import type { CapabilityContext } from "../contracts.js";
import type { Workbook } from "../workbook.js";
import { Binary, readBiffRecords } from "./biff-binary.js";
import { biffNode, readBiffMetadata } from "./biff-metadata.js";
import { words } from "./biff-write-binary.js";
import { readBiff } from "./biff.js";
import { writeBiffStream } from "./biff-write.js";
import { createXlsxWriter, readXlsx } from "./xlsx.js";
import { metadataNode } from "./xlsx-write-support.js";
const context: CapabilityContext = { signal: new AbortController().signal, own() {},
  environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 100000, outputBytes: 100000, cells: 100, sheets: 4, operations: 1000 } };
for (const revision of [7, 8] as const) {
  for (const reverse of [false, true]) it(`imports BIFF${revision} fit page counts regardless of SETUP order (${reverse})`, () => {
    const setup = new Uint8Array(34); setup.set(words(9, 75, 1, 2, 3, 2));
    const records = [
      { opcode: 0x81, offset: 0, data: new Binary(words(0x5c1)) },
      { opcode: 0xa1, offset: 6, data: new Binary(setup) }
    ];
    const parsed = readBiffMetadata(reverse ? records.reverse() : records, revision, 1252, context);
    expect(metadataNode(parsed.records.find(r => r.kind === "PrintInformation")?.data)?.children.find(n => n.name === "Scale")?.attributes)
      .toEqual({ type: "fit", cols: "2", rows: "3" });
  });
  for (const type of ["fit", "size_fit"]) for (const [cols, rows] of [[2, 3], [0, 3], [2, 0]] as const) it(`preserves BIFF${revision} ${type} to ${cols} by ${rows} pages from XLSX`, async () => {
    const source: Workbook = { sheets: [{ id: "s", name: "Sheet1", cells: [], unsupportedRecords: [
      { source: "Gnumeric_XmlIO:sax", kind: "PrintInformation", disposition: "retained", data:
        biffNode("PrintInformation", {}, "", [biffNode("Scale", { type, cols, rows })]) }
    ] }] };
    const direct = await writeBiffStream(source, revision, false, context);
    expect(readBiffRecords(direct, context).find(r => r.opcode === 0x81)!.data.u16(0) & 0x100).toBe(0x100);
    const xlsx = await readXlsx(await createXlsxWriter("2008")(source, [], context), context);
    const bytes = await writeBiffStream(xlsx, revision, false, context), records = readBiffRecords(bytes, context);
    expect(records.find(r => r.opcode === 0x81)!.data.u16(0) & 0x100).toBe(0x100);
    const restored = await readBiff(bytes, context);
    expect(metadataNode(restored.sheets[0]!.unsupportedRecords?.find(r => r.kind === "PrintInformation")?.data)?.children.find(n => n.name === "Scale")?.attributes)
      .toEqual({ type: "fit", cols: String(cols), rows: String(rows) });
  });
  it(`keeps BIFF${revision} percentage printing independent from fit counts`, async () => {
    const source: Workbook = { sheets: [{ id: "s", name: "Sheet1", cells: [], unsupportedRecords: [
      { source: "Gnumeric_XmlIO:sax", kind: "PrintInformation", disposition: "retained", data:
        biffNode("PrintInformation", {}, "", [biffNode("Scale", { type: "percentage", percentage: 75, cols: 2, rows: 3 })]) }
    ] }] };
    const bytes = await writeBiffStream(source, revision, false, context), records = readBiffRecords(bytes, context);
    expect(records.find(r => r.opcode === 0x81)!.data.u16(0) & 0x100).toBe(0);
    const restored = await readBiff(bytes, context);
    expect(metadataNode(restored.sheets[0]!.unsupportedRecords?.find(r => r.kind === "PrintInformation")?.data)?.children.find(n => n.name === "Scale")?.attributes)
      .toEqual({ type: "percentage", percentage: "75" });
  });
}
