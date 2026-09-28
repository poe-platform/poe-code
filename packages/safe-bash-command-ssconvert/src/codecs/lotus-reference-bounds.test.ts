import { expect, it } from "vitest";
import type { CapabilityContext } from "../contracts.js";
import { readLotus } from "./lotus.js";
import { recalculateWorkbook } from "../formulas/evaluator.js";

const context: CapabilityContext = { signal: new AbortController().signal, own() {},
  environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 10000, outputBytes: 100000, cells: 100, sheets: 2, operations: 1000 } };
const word = (value: number) => [value & 255, value >>> 8];
const record = (id: number, data: number[] = []) => [...word(id), ...word(data.length), ...data];
function input(version: number, windows: boolean, tokens: number[], row: number, column: number): Uint8Array {
  return Uint8Array.from([...record(windows ? 255 : 0, word(version)),
    ...record(16, [...(windows ? [...word(column), ...word(row), 0, 0] : [0, ...word(column), ...word(row)]),
      ...Array<number>(8).fill(0), ...word(tokens.length + 1), ...tokens, 3]), ...record(1)]);
}

// #3470 requires native sheet bounds after decoding, including libwps offsets
// that otherwise resolve past IV. Preserve the signed relative wrapping rules.
for (const [profile, version, windows, rows] of [["WK1", 0x404, false, 2048],
  ["WK2", 0x406, false, 16384], ["Symphony", 0x405, false, 16384],
  ["Windows Works", 0x404, true, 16384]] as const) {
  for (const axis of ["column", "row"] as const) {
    for (const range of ["single", "first", "last"] as const) {
      it(`${profile} rejects positive ${axis} overflow in ${range} references`, async () => {
        // Works/Symphony fold a relative row target by 8192 before bounds.
        const originRow = rows - 1 + (axis === "row" && (windows || version === 0x405) ? 8192 : 0);
        const invalid = [...word(axis === "column" ? 0x8001 : 0), ...word(axis === "row" ? 0x8001 : 0)];
        const valid = [...word(0), ...word(0)];
        const tokens = range === "single" ? [1, ...invalid] :
          [2, ...(range === "first" ? invalid : valid), ...(range === "last" ? invalid : valid), 80, 1];
        const book = await readLotus(input(version, windows, tokens, axis === "row" ? originRow : 0, axis === "column" ? 255 : 0), context);
        expect(book.sheets[0]!.cells[0]!.formula).toBe(range === "single" ? "=#REF!" : "=SUM(#REF!)");
        expect(recalculateWorkbook(book, context, true).sheets[0]!.cells[0]!.value).toEqual({ kind: "error", value: "#REF!" });
      });
    }
  }
  it(`${profile} retains the final valid absolute row and column`, async () => {
    const book = await readLotus(input(version, windows, [1, ...word(255), ...word(rows - 1)], 0, 0), context);
    expect(book.sheets[0]!.cells[0]!.formula).toBe(`=$IV$${rows}`);
  });
}

// #3529 explicitly requests masking absolute fields, unlike libwps 0.4.14's
// raw absolute path. Bit 14 is not part of a 14-bit row coordinate.
for (const [profile, version, windows] of [["Symphony", 0x405, false], ["Windows Works", 0x404, true]] as const) {
  it.each([0x4000, 0x4001, 0x7fff])(`${profile} masks absolute row flags %i`, async raw => {
    const book = await readLotus(input(version, windows, [1, ...word(1), ...word(raw)], 0, 0), context);
    expect(book.sheets[0]!.cells[0]!.formula).toBe(`=$B$${(raw & 0x3fff) + 1}`);
  });
  it(`${profile} masks both absolute range endpoints`, async () => {
    const book = await readLotus(input(version, windows, [2, ...word(0), ...word(0x4000), ...word(1), ...word(0x4001)], 2, 2), context);
    expect(book.sheets[0]!.cells[0]!.formula).toBe("=$A$1:$B$2");
  });
}
it.each([0x100, 0x101, 0x7fff])("masks Symphony absolute column flags %i", async raw => {
  const book = await readLotus(input(0x405, false, [1, ...word(raw), ...word(0)], 0, 0), context);
  expect(book.sheets[0]!.cells[0]!.formula).toBe(raw === 0x100 ? "=$A$1" : raw === 0x101 ? "=$B$1" : "=$IV$1");
});
it("rejects an unmasked Windows Works absolute column outside IV", async () => {
  const book = await readLotus(input(0x404, true, [1, ...word(256), ...word(0)], 0, 0), context);
  expect(book.sheets[0]!.cells[0]!.formula).toBe("=#REF!");
});
