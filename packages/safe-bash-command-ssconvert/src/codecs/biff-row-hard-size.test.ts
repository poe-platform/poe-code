import { expect, it } from "vitest";
import type { CapabilityContext } from "../contracts.js";
import { BiffOutput, words } from "./biff-write-binary.js";
import { readBiffRecords } from "./biff-binary.js";
import { writeBiffStream } from "./biff-write.js";
import { readBiff } from "./biff.js";
const context: CapabilityContext = { signal: new AbortController().signal, own() {},
  environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 100000, outputBytes: 100000, cells: 100, sheets: 4, operations: 1000 } };
for (const revision of [7, 8] as const) for (const height of [255, 400]) {
  it.each([0, 0x40])(`preserves BIFF${revision} row height ${height} fixed flag %s`, async flags => {
    const input = new BiffOutput(context, 8224);
    input.record(0x809, words(revision === 8 ? 0x600 : 0x500, 16, 0, 0));
    input.record(0x225, words(0, 255));
    input.record(0x208, words(1, 0, 1, height, 0, 0, flags | 0x20, 0)); input.record(10);
    const book = await readBiff(input.finish(), context);
    expect(book.sheets[0]!.rows?.[0]?.style?.gnumeric).toMatchObject({ attributes: [{ name: "HardSize", value: flags ? "1" : "0" }] });
    const records = readBiffRecords(await writeBiffStream(book, revision, false, context), context);
    expect(records.find(record => record.opcode === 0x208)?.data.u16(12)).toBe(0x120 | flags);
  });
}
it("retains a fixed row even when its height equals the sheet default", async () => {
  const input = new BiffOutput(context, 8224);
  input.record(0x809, words(0x600, 16, 0, 0));
  input.record(0x208, words(1, 0, 1, 255, 0, 0, 0x40, 0)); input.record(10);
  expect((await readBiff(input.finish(), context)).sheets[0]!.rows).toHaveLength(1);
});
it.each(["0", "1"])("honors existing shared HardSize=%s metadata on export", async value => {
  const book = { sheets: [{ id: "s", name: "S", cells: [], rows: [{ index: 1, sizePoints: 20,
    style: { gnumeric: { name: "RowInfo", namespace: "http://www.gnumeric.org/v10.dtd", attributes: [{ name: "HardSize", namespace: "", value }], children: [], text: "" } } }] }] };
  const records = readBiffRecords(await writeBiffStream(book, 8, false, context), context);
  expect(records.find(record => record.opcode === 0x208)?.data.u16(12)).toBe(value === "1" ? 0x140 : 0x100);
});
