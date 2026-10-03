import { expect, it } from "vitest";
import type { CapabilityContext } from "../contracts.js";
import { BiffOutput, words } from "./biff-write-binary.js";
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
