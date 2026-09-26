import { expect, it } from "vitest";
import type { CapabilityContext } from "../contracts.js";
import type { Workbook } from "../workbook.js";
import { recalculateWorkbook } from "./evaluator.js";
import { setCellText } from "../workbook/updates/index.js";
import { createBiffWriter, readBiff } from "../codecs/biff.js";
import { readCfb } from "../codecs/biff-binary.js";

const context: CapabilityContext = { signal: new AbortController().signal, own() {},
  environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 1000000, outputBytes: 1000000, cells: 1000, sheets: 8, operations: 10000 } };
const n = (value: number) => ({ kind: "number" as const, value });
function input(expression: string, formula = "=Data!Target", position = { sheet: "data", row: 2, column: 2 }): Workbook {
  return { names: [{ name: "Target", sheet: "data", expression, position }], sheets: [
    { id: "here", name: "Here", size: { rows: 128, columns: 128 }, cells: [
      { row: 1, column: 1, formula, value: n(99), cachedResult: n(99), formulaDirty: false },
      { row: 127, column: 127, value: n(17) }, { row: 0, column: 127, value: n(31) },
      { row: 127, column: 0, value: n(37) }, { row: 0, column: 0, value: n(41) }
    ] }, { id: "data", name: "Data", size: { rows: 256, columns: 256 }, cells: [
      { row: 255, column: 255, value: n(29) }
    ] }
  ] };
}

it.each([["A1", 17], ["A$1", 31], ["$A1", 37], ["Data!A1", 29]] as const)("wraps relative axes in %s using the resolved sheet size", (expression, value) => {
  const book = input(expression), before = structuredClone(book);
  expect(recalculateWorkbook(book, context, true).sheets[0]!.cells[0]!.value).toEqual(n(value));
  expect(book).toEqual(before);
});

it("wraps positive offsets and keeps absolute out-of-range coordinates invalid", () => {
  const position = { sheet: "data", row: 0, column: 0 };
  expect(recalculateWorkbook(input("DX128", undefined, position), context, true).sheets[0]!.cells[0]!.value).toEqual(n(41));
  expect(recalculateWorkbook(input("$DX$129", undefined, position), context, true).sheets[0]!.cells[0]!.value)
    .toEqual({ kind: "error", value: "#REF!" });
});

it("normalizes wrapped range endpoints after resolving their axes", () => {
  expect(recalculateWorkbook(input("A1:B1", "=SUM(Data!Target)"), context, true).sheets[0]!.cells[0]!.value).toEqual(n(54));
});

it.each(["=Data!Target", '=INDIRECT("Data!Target")'])("invalidates the wrapped named precedent for %s", formula => {
  const book = input("A1", formula);
  const changed = setCellText(book, { sheet: "here", startRow: 127, endRow: 127, startColumn: 127, endColumn: 127 }, "73", context);
  expect(changed.sheets[0]!.cells[0]!.formulaDirty).toBe(true);
  expect(recalculateWorkbook(changed, context).sheets[0]!.cells[0]!.value).toEqual(n(73));
});

it.each([7, 8, "dsf"] as const)("replays signed BIFF %s named offsets at the caller", async profile => {
  const book: Workbook = { names: [["Relative", "A1"], ["FixedCol", "$B1"], ["FixedRow", "A$2"], ["Qualified", "Data!A1"]].map(([name, expression]) => ({
    name: name!, sheet: "data", expression: expression!, position: { sheet: "data", row: 2, column: 2 }
  })), sheets: ["Here", "Data"].map((name, index) => ({ id: name.toLowerCase(), name,
    cells: [...Array.from({ length: 8 }, (_, row) => Array.from({ length: 3 }, (_, column) => ({ row, column,
      value: n((index + 1) * 1000 + row * 10 + column + 1) }))).flat(),
    ...(index === 0 ? ["=Data!Relative", "=Data!FixedCol", "=Data!FixedRow", "=Data!Qualified", '=INDIRECT("Data!Relative")'].map((formula, i) =>
      ({ row: 4 + i, column: 4, formula, value: n(99) })) : [])]
  })) };
  const expected = recalculateWorkbook(book, context, true).sheets[0]!.cells.filter(cell => cell.column >= 4).map(cell => cell.value);
  expect(expected).toEqual([1023, 1032, 1013, 2053, 1063].map(n));
  for (const [stream, bytes] of readCfb(await createBiffWriter(profile)(book, [], context), context)) {
    const replay = recalculateWorkbook(await readBiff(bytes, context), context, true);
    expect(replay.sheets[0]!.cells.filter(cell => cell.column >= 4).map(cell => cell.value), stream).toEqual(expected);
  }
});
