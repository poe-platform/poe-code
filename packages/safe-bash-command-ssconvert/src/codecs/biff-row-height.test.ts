import { expect, it } from "vitest";
import type { CapabilityContext } from "../contracts.js";
import { BiffOutput, words } from "./biff-write-binary.js";
import { readBiffRecords } from "./biff-binary.js";
import { writeBiffStream } from "./biff-write.js";
import { readBiff } from "./biff.js";
const context: CapabilityContext = { signal: new AbortController().signal, own() {},
  environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 100000, outputBytes: 100000, cells: 100, sheets: 4, operations: 1000 } };
for (const revision of [7, 8] as const) {
  for (const opcode of [0x25, 0x225]) {
    it.each([1, 79, 80, 255, 301, 600, 8191, 32767])(`preserves BIFF${revision} default row height (${opcode}) %s`, async height => {
      const input = new BiffOutput(context, 8224);
      input.record(0x809, words(revision === 8 ? 0x600 : 0x500, 16, 0, 0));
      input.record(opcode, opcode === 0x25 ? words(height) : words(0, height)); input.record(10);
      const book = await readBiff(input.finish(), context);
      expect(book.sheets[0]!.view?.defaultRowHeight).toBe(0.05 * height);
      const output = await writeBiffStream(book, revision, false, context);
      expect(readBiffRecords(output, context).find(record => record.opcode === 0x225)?.data.u16(2)).toBe(height);
      expect((await readBiff(output, context)).sheets[0]!.view?.defaultRowHeight).toBe(0.05 * height);
      const edited = { ...book, sheets: book.sheets.map(sheet => ({ ...sheet, view: { ...sheet.view, defaultRowHeight: 24.6 } })) };
      const warnings: string[] = [];
      const changed = await writeBiffStream(edited, revision, false, { ...context, async diagnostic(d) { warnings.push(d.message); } });
      expect(readBiffRecords(changed, context).find(record => record.opcode === 0x225)?.data.u16(2)).toBe(492);
      expect(warnings.filter(message => message.includes("DEFAULTROWHEIGHT"))).toEqual([]);
    });
  }
}
it.each([0, 0.001, -1, Number.NaN, Number.POSITIVE_INFINITY, 4000])("refuses unrepresentable default row height %s", async height => {
  const book = { sheets: [{ id: "s", name: "S", cells: [], view: { defaultRowHeight: height } }] };
  await expect(writeBiffStream(book, 8, false, context)).rejects.toThrow("row height");
});

it("ignores a zero default height like the native importer", async () => {
  const input = new BiffOutput(context, 8224);
  input.record(0x809, words(0x600, 16, 0, 0));
  input.record(0x225, words(0, 400)); input.record(0x225, words(0, 0)); input.record(10);
  expect((await readBiff(input.finish(), context)).sheets[0]!.view?.defaultRowHeight).toBe(20);
});
