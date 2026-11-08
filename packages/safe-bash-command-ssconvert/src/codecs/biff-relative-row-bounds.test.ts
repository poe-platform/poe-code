import { expect, it } from "vitest";
import type { CapabilityContext } from "../contracts.js";
import type { Workbook } from "../workbook.js";
import { recalculateWorkbook } from "../formulas/evaluator.js";
import { createBiffWriter, readBiff } from "./biff.js";
import { translateBiffFormula } from "./biff-formulas.js";

const context: CapabilityContext = { signal: new AbortController().signal, own() {},
  environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 100000, outputBytes: 100000, cells: 100, sheets: 4, operations: 1000 } };
const word = (value: number) => [value & 255, value >>> 8 & 255];

for (const revision of [7, 8] as const) for (const area of [false, true]) for (const end of [false, true]) {
  const rows = revision === 8 ? 65536 : 16384, row = end ? rows - 1 : 0;
  it(`wraps BIFF${revision} relative ${area ? "area" : "cell"} rows at the ${end ? "last" : "first"} row`, () => {
    const first = end ? 1 : -1, last = end ? 2 : 1;
    const rowBits = (offset: number) => revision === 8 ? word(offset) : word((offset & 0x3fff) | 0x8000);
    const columnBits = (column: number) => revision === 8 ? word(column | 0x8000) : [column];
    const bytes = Uint8Array.from([area ? 0x2d : 0x2c, ...rowBits(first),
      ...(area ? [...rowBits(last), ...columnBits(0), ...columnBits(1)] : columnBits(0))]);
    expect(translateBiffFormula(bytes, { revision, row, column: 0, codepage: 1252,
      names: [], externalSheets: [], limit: 100 }))
      .toBe(`=$A${end ? 1 : rows}${area ? ":$B2" : ""}`);
  });
}

it("wraps a shared BIFF7 3D row offset using the legacy sheet height", () => {
  const bytes = new Uint8Array(18), view = new DataView(bytes.buffer);
  bytes[0] = 0x3a;
  view.setInt16(1, -1, true); view.setUint16(11, 1, true); view.setUint16(13, 1, true);
  view.setUint16(15, 0xbfff, true);
  expect(translateBiffFormula(bytes, { revision: 7, row: 0, column: 0, codepage: 1252,
    names: [], externalSheets: ["First"], shared: true, limit: 100 })).toBe("='First'!$A16384");
});

it.each([7, 8] as const)("preserves a BIFF%i relative name at the final row through export and recalculation", async revision => {
  const rows = revision === 8 ? 65536 : 16384;
  const book: Workbook = { names: [{ name: "Edge", expression: `=$A${rows}` }],
    sheets: [{ id: "s", name: "Sheet", cells: [
      { row: 0, column: 1, formula: "=Edge", value: { kind: "number", value: 999 } },
      { row: rows - 1, column: 0, value: { kind: "number", value: 42 } }
    ] }] };
  const reopened = await readBiff(await createBiffWriter(revision)(book, [], context), context);
  expect(reopened.names?.find(name => name.name === "Edge")?.expression).toBe(`=$A${rows}`);
  expect(recalculateWorkbook(reopened, context, true).sheets[0]!.cells[0]!.value)
    .toEqual({ kind: "number", value: 42 });
});
