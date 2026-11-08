import { expect, it } from "vitest";
import type { CapabilityContext } from "../contracts.js";
import { readLotus } from "./lotus.js";
import { recalculateWorkbook } from "../formulas/evaluator.js";

const context: CapabilityContext = {
  signal: new AbortController().signal, own() {},
  environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 10000, outputBytes: 10000, cells: 100, sheets: 4, operations: 1000 }
};
const word = (value: number) => [value & 255, value >>> 8];
const record = (id: number, data: number[] = []) => [...word(id), ...word(data.length), ...data];
function input(version: number, tokens: number[], row = 1, column = 1): Uint8Array {
  const formula = [...tokens, 3];
  return Uint8Array.from([
    ...record(0, word(version)),
    ...record(13, [0, 0, 0, 0, 0, 42, 0]),
    ...record(16, [0, ...word(column), ...word(row), ...Array<number>(8).fill(0), ...word(formula.length), ...formula]),
    ...record(1)
  ]);
}

// LibreOffice ScanVersion binds these BOF versions to LotusRelToScRel's
// distinct row widths; its two's-complement column width is always eight bits.
for (const version of [0x404, 0x406]) {
  it(`imports negative Lotus ${version.toString(16)} offsets and recalculates the referenced cell`, async () => {
    const book = await readLotus(input(version, [1, ...word(0xbfff), ...word(0xbfff)]), context);
    expect(book.sheets[0]!.cells[1]!.formula).toBe("=A1");
    const result = recalculateWorkbook(book, context, true);
    expect(result.sheets[0]!.cells[1]!.value).toEqual({ kind: "number", value: 42 });
  });
  it(`preserves mixed absolute/relative Lotus ${version.toString(16)} range endpoints`, async () => {
    const book = await readLotus(input(version, [2, ...word(0xbfff), ...word(0), ...word(1), ...word(0xbfff)]), context);
    expect(book.sheets[0]!.cells[1]!.formula).toBe("=A$1:$B1");
  });
  it(`preserves zero and positive Lotus ${version.toString(16)} offsets`, async () => {
    const book = await readLotus(input(version, [2, ...word(0x8000), ...word(0x8000), ...word(0x8001), ...word(0x8001)]), context);
    expect(book.sheets[0]!.cells[1]!.formula).toBe("=B2:C3");
  });
  it(`keeps out-of-sheet negative Lotus ${version.toString(16)} offsets invalid`, async () => {
    const book = await readLotus(input(version, [1, ...word(0xbfff), ...word(0xbfff)], 0, 1), context);
    expect(book.sheets[0]!.cells[1]!.formula).toBe("=#REF!");
  });
}
it.each([[0x404, 0x8400, 1024], [0x406, 0x9000, 4096]])(
  "sign-extends the version-specific negative row boundary for Lotus %i", async (version, encoded, base) => {
    const book = await readLotus(input(version, [1, ...word(0), ...word(encoded)], base, 1), context);
    expect(book.sheets[0]!.cells[1]!.formula).toBe("=$A1");
  }
);
it.each([[0x404, 0x07ff, "=$IV$2048"], [0x406, 0x3fff, "=$IV$16384"]] as const)(
  "preserves the source-defined absolute row width for Lotus %i", async (version, row, formula) => {
    const book = await readLotus(input(version, [1, ...word(255), ...word(row)]), context);
    expect(book.sheets[0]!.cells[1]!.formula).toBe(formula);
  }
);
