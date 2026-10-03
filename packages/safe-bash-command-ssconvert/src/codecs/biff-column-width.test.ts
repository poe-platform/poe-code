import { expect, it } from "vitest";
import type { CapabilityContext } from "../contracts.js";
import { BiffOutput, words } from "./biff-write-binary.js";
import { readBiffRecords } from "./biff-binary.js";
import { writeBiffStream } from "./biff-write.js";
import { readBiff } from "./biff.js";
const context: CapabilityContext = { signal: new AbortController().signal, own() {},
  environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 100000, outputBytes: 100000, cells: 100, sheets: 4, operations: 1000 } };
function fixture(revision: 7 | 8, name: string, points: number, width: number, defaultWidth?: number): Uint8Array {
  const output = new BiffOutput(context, 8224);
  output.record(0x809, words(revision === 8 ? 0x600 : 0x500, 16, 0, 0));
  for (const [fontName, size] of [["Arial", 10], [name, points]] as const) {
    const font = new Uint8Array(15 + (revision === 8 ? 1 : 0) + fontName.length), view = new DataView(font.buffer);
    view.setUint16(0, size * 20, true); view.setUint16(6, 400, true); font[14] = fontName.length;
    font.set(new TextEncoder().encode(fontName), revision === 8 ? 16 : 15); output.record(0x31, font);
  }
  const xf = new Uint8Array(revision === 8 ? 20 : 16); xf[0] = 1; output.record(0xe0, xf);
  if (defaultWidth !== undefined) output.record(0x55, words(defaultWidth));
  output.record(0x7d, words(1, 2, width, 0, 0x1200, 0)); output.record(10); return output.finish();
}
for (const revision of [7, 8] as const) {
  it.each([
    ["Arial", 12, 2048, 50.4], ["Arial", 10, 2340, 48],
    ["Calibri", 11, 2304, 59.4], ["Courier New", 10, 2304, 54],
    ["Times New Roman", 10, 2389, 42], ["Georgia", 20, 2275, 120],
    ["Kartika", 10, 2457, 36], ["WST_Engl", 10, 2252, 66],
    ["Wingdings", 10, 2288, 114], ["Wingdings 2", 10, 2321, 102],
    ["Wingdings 3", 10, 2218, 78], ["Marlett", 10, 2363, 90],
    ["cALIbRI", 11, 2304, 59.4], ["Unknown Font", 12, 2048, 50.4],
    ["Arial", 10, 100, 4], ["Arial", 10, 200, 4.027397260273972]
  ] as const)(`imports BIFF${revision} %s %spt width %s`, async (font, points, width, expected) => {
    const book = await readBiff(fixture(revision, font, points, width), context);
    expect(book.sheets[0]!.columns).toHaveLength(2);
    for (const column of book.sheets[0]!.columns!) {
      expect(column.sizePoints).toBeCloseTo(expected, 12);
      expect(column).toMatchObject({ hidden: false, outlineLevel: 2, collapsed: true });
    }
  });
  it.each([0, 1])(`uses BIFF${revision} default width for hidden column %s`, async width => {
    const book = await readBiff(fixture(revision, "Arial", 12, width, 10), context);
    expect(book.sheets[0]!.columns?.[0]).toMatchObject({ sizePoints: 72, hidden: true });
  });
}

it.each([
  [10, 2339, 47.97945205479452], [12, 2048, 50.39999999999999],
  [12, 2341, 57.624657534246566]
] as const)("retains native full-precision width for %spt / %s", async (points, width, expected) => {
  const book = await readBiff(fixture(8, "Arial", points, width), context);
  expect(book.sheets[0]!.columns?.[0]?.sizePoints).toBe(expected);
});

for (const revision of [7, 8] as const) {
  it.each([
    ["Arial", 12, 7, 50.39999999999999], ["Calibri", 11, 10, 74.25000000000001],
    ["Times New Roman", 10, 9, 47.25], ["Wingdings", 12, 7, 119.7]
  ] as const)(`preserves BIFF${revision} default widths and Normal font %s`, async (name, points, characters, expected) => {
    const input = await readBiff(fixture(revision, name, points, 2048, characters), context);
    expect(input.sheets[0]!.view?.defaultColumnWidth).toBeCloseTo(expected, 12);
    const output = await writeBiffStream(input, revision, false, context);
    const records = readBiffRecords(output, context);
    expect(records.find(record => record.opcode === 0x55)?.data.u16(0)).toBe(characters);
    expect(records.find(record => record.opcode === 0x31)?.data.u16(0)).toBe(points * 20);
    expect(records.find(record => record.opcode === 0x7d)?.data.u16(4)).toBe(2048);
    const restored = await readBiff(output, context);
    expect(restored.sheets[0]!.view?.defaultColumnWidth).toBe(input.sheets[0]!.view?.defaultColumnWidth);
    expect(restored.sheets[0]!.columns).toEqual(input.sheets[0]!.columns);
  });
  it(`exports BIFF${revision} edited default width with the emitted Normal font`, async () => {
    const input = await readBiff(fixture(revision, "Calibri", 12, 2048, 8), context);
    const edited = { ...input, sheets: input.sheets.map(sheet => ({ ...sheet, view: { ...sheet.view, defaultColumnWidth: 97.2 } })) };
    const warnings: string[] = [];
    const output = await writeBiffStream(edited, revision, false, { ...context, async diagnostic(d) { warnings.push(d.message); } });
    expect(warnings).not.toContain("Unsupported Excel BIFF export metadata: DEFCOLWIDTH");
    expect(readBiffRecords(output, context).find(record => record.opcode === 0x55)?.data.u16(0)).toBe(12);
    expect((await readBiff(output, context)).sheets[0]!.view?.defaultColumnWidth).toBeCloseTo(97.2, 12);
  });
}

it.each([-1, Number.NaN, Number.POSITIVE_INFINITY, 400000])("refuses unrepresentable BIFF default width %s", async width => {
  const book = { sheets: [{ id: "s", name: "S", cells: [], view: { defaultColumnWidth: width } }] };
  await expect(writeBiffStream(book, 8, false, context)).rejects.toThrow("column width");
});
it.each([0, -1, Number.NaN, 4000])("refuses unrepresentable BIFF Normal-font size %s", async points => {
  const book = { sheets: [{ id: "s", name: "S", cells: [] }], view: { defaultStyle: {
    name: "Style", namespace: "http://www.gnumeric.org/v10.dtd", attributes: [], text: "", children: [{
      name: "Font", namespace: "http://www.gnumeric.org/v10.dtd", attributes: [{ name: "Unit", namespace: "", value: String(points) }], text: "Arial", children: []
    }]
  } } };
  await expect(writeBiffStream(book, 8, false, context)).rejects.toThrow("Normal font");
});
