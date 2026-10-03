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

for (const revision of [7, 8] as const) {
  it(`retains BIFF${revision} heights of rows instantiated before a later default`, async () => {
    const input = new BiffOutput(context, 8224);
    input.record(0x809, words(revision === 8 ? 0x600 : 0x500, 16, 0, 0));
    input.record(0x27e, words(0, 0, 0, 6, 0));
    input.record(0x201, words(3, 0, 0));
    input.record(0x225, words(0, 400));
    input.record(0x27e, words(1, 0, 0, 6, 0));
    input.record(0x225, words(0, 600));
    input.record(0x27e, words(0, 1, 0, 6, 0));
    input.record(10);
    const book = await readBiff(input.finish(), context);
    expect(book.sheets[0]!.rows).toEqual([{ index: 0, sizePoints: 12.75 }, { index: 1, sizePoints: 20 }]);
    const restored = await readBiff(await writeBiffStream(book, revision, false, context), context);
    expect(restored.sheets[0]!.rows).toEqual(book.sheets[0]!.rows);
    expect(restored.sheets[0]!.view?.defaultRowHeight).toBe(30);
  });
  it.each([0, 0x8000 | 123])(`uses BIFF${revision} current row height for ignored ROW size %s`, async height => {
    const input = new BiffOutput(context, 8224);
    input.record(0x809, words(revision === 8 ? 0x600 : 0x500, 16, 0, 0));
    input.record(0x225, words(0, 400));
    input.record(0x208, words(1, 0, 1, 500, 0, 0, 0x20, 0));
    input.record(0x208, words(1, 0, 1, height, 0, 0, 0, 0));
    input.record(0x208, words(2, 0, 1, height, 0, 0, 0x22, 0));
    input.record(0x225, words(0, 600)); input.record(10);
    const rows = (await readBiff(input.finish(), context)).sheets[0]!.rows;
    expect(rows).toHaveLength(2);
    expect(rows?.[0]).toMatchObject({ index: 1, sizePoints: 25, hidden: true });
    expect(rows?.[1]).toMatchObject({ index: 2, sizePoints: 20, hidden: true, outlineLevel: 2 });
  });
}

it("uses the sheet default for row metadata without an explicit height", async () => {
  const book = { sheets: [{ id: "s", name: "S", cells: [], view: { defaultRowHeight: 30 }, rows: [{ index: 1, hidden: true }] }] };
  const restored = await readBiff(await writeBiffStream(book, 8, false, context), context);
  expect(restored.sheets[0]!.rows?.[0]).toMatchObject({ index: 1, hidden: true, sizePoints: 30 });
});

it("instantiates a formula row even when its cached value is blank", async () => {
  const input = new BiffOutput(context, 8224);
  input.record(0x809, words(0x600, 16, 0, 0));
  const formula = new Uint8Array(25); formula[6] = 3; formula[12] = 255; formula[13] = 255;
  formula[20] = 3; formula.set([0x1e, 1, 0], 22); input.record(6, formula);
  input.record(0x225, words(0, 600)); input.record(10);
  expect((await readBiff(input.finish(), context)).sheets[0]!.rows).toEqual([{ index: 0, sizePoints: 12.75 }]);
});

for (const revision of [7, 8] as const) {
  it.each([0, 0.001, -1, Number.NaN, Number.POSITIVE_INFINITY, 1638.4, 3276.8])(`refuses BIFF${revision} unrepresentable custom row height %s`, async height => {
    const book = { sheets: [{ id: "s", name: "S", cells: [], rows: [{ index: 1, sizePoints: height }] }] };
    await expect(writeBiffStream(book, revision, false, context)).rejects.toThrow("row height");
  });
  it.each([[0.05, 1], [12.79, 255], [24.629, 492], [100.049, 2000], [1638.399, 32767]])(`quantizes BIFF${revision} custom row height %s like native`, async (height, twips) => {
    const book = { sheets: [{ id: "s", name: "S", cells: [], rows: [{ index: 1, sizePoints: height }] }] };
    const records = readBiffRecords(await writeBiffStream(book, revision, false, context), context);
    expect(records.find(record => record.opcode === 0x208)?.data.u16(6)).toBe(twips);
  });
  it.each([undefined, 3000])(`preserves BIFF${revision} a large inherited row height %s`, async sizePoints => {
    const book = { sheets: [{ id: "s", name: "S", cells: [], view: { defaultRowHeight: 3000 }, rows: [{ index: 1, hidden: true, ...(sizePoints === undefined ? {} : { sizePoints }) }] }] };
    const output = await writeBiffStream(book, revision, false, context);
    expect(readBiffRecords(output, context).find(record => record.opcode === 0x208)?.data.u16(6)).toBe(0x8000);
    expect((await readBiff(output, context)).sheets[0]!.rows?.[0]).toMatchObject({ sizePoints: 3000, hidden: true });
  });
}
