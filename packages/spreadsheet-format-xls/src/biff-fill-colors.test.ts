import { expect, it } from "vitest";
import type { CapabilityContext } from "@poe-code/spreadsheet-engine/contracts";
import { metadataNode } from "@poe-code/spreadsheet-engine/codecs/xlsx-write-support";
import { createBiffWriter, readBiff } from "./biff.js";
import { readBiffRecords, readCfb } from "./biff-binary.js";
import { biffNode } from "./biff-metadata.js";
import { BiffOutput, words } from "./biff-write-binary.js";
const context: CapabilityContext = { signal: new AbortController().signal, own() {}, environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 1000000, outputBytes: 1000000, cells: 100, sheets: 4, operations: 10000 } };
for (const revision of [7, 8] as const) for (const shade of [0, 1, 2]) {
  const input = { sheets: [{ id: "s", name: "Data", cells: [{ row: 0, column: 0, value: { kind: "number" as const, value: 1 },
    style: { gnumeric: biffNode("Style", { Shade: shade, Back: "FFFF:FFFF:0", PatternColor: "FFFF:0:0" }) } }] }] };
  it(`encodes BIFF${revision} shade${shade} wire foreground/background independently`, async () => {
    const streams = readCfb(await createBiffWriter(revision)(input, [], context), context);
    const records = readBiffRecords(streams.get("Workbook") ?? streams.get("Book")!, context);
    const xf = records.filter(record => record.opcode === 0xe0).at(-1)!;
    const fill = xf.data.u16(revision === 8 ? 18 : 8);
    expect(fill & 127).toBe(shade === 1 ? 5 : 2);
    expect(fill >> 7 & 127).toBe(shade === 1 ? 2 : 5);
  });
  it(`decodes independent BIFF${revision} shade${shade} wire colors`, async () => {
    const streams = readCfb(await createBiffWriter(revision)(input, [], context), context);
    const bytes = streams.get("Workbook") ?? streams.get("Book")!;
    const xf = readBiffRecords(bytes, context).filter(record => record.opcode === 0xe0).at(-1)!;
    xf.data.view.setUint16(revision === 8 ? 18 : 8, shade === 1 ? 5 | 2 << 7 : 2 | 5 << 7, true);
    const style = metadataNode((await readBiff(bytes, context)).sheets[0]!.cells[0]!.style!.gnumeric)!;
    expect(style.attributes.Back).toBe("FFFF:FFFF:0");
    expect(style.attributes.PatternColor).toBe("FFFF:0:0");
  });
}
for (const revision of [3, 4]) it(`decodes independent BIFF${revision} solid-fill colors`, async () => {
  const out = new BiffOutput(context, 2080);out.record(revision === 3 ? 0x209 : 0x409, words(revision << 8, 0x10));
  const xf = new Uint8Array(12);new DataView(xf.buffer).setUint16(6, 1 | 5 << 6 | 2 << 11, true);out.record(revision === 3 ? 0x243 : 0x443, xf);
  const number = new Uint8Array(14);new DataView(number.buffer).setFloat64(6, 1, true);out.record(0x203, number);out.record(10);
  const style = metadataNode((await readBiff(out.finish(), context)).sheets[0]!.cells[0]!.style!.gnumeric)!;
  expect(style.attributes.Back).toBe("FFFF:FFFF:0");expect(style.attributes.PatternColor).toBe("FFFF:0:0");
});
