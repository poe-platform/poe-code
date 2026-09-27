import { expect, it } from "vitest";
import type { CapabilityContext } from "../contracts.js";
import { readLotus } from "./lotus.js";
import { recalculateWorkbook } from "../formulas/evaluator.js";

const context: CapabilityContext = { signal: new AbortController().signal, own() {},
  environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 10000, outputBytes: 10000, cells: 100, sheets: 4, operations: 1000 } };
const word = (value: number) => [value & 255, value >>> 8];
const record = (id: number, data: number[] = []) => [...word(id), ...word(data.length), ...data];
const sheetNames = ["First's", "Middle sheet", "Last"];
function input(id: number, owner: number, first: number, last: number): Uint8Array {
  return Uint8Array.from([
    ...record(0, [...word(0x1002), 4, 0, ...Array<number>(22).fill(0)]),
    ...record(id, [1, 0, owner, 1, ...Array<number>(id === 25 ? 10 : 8).fill(0),
      2, 0, 0, 0, first, 0, 0, 0, last, 0, 80, 1, 3]),
    ...[11, 13, 17].flatMap((value, sheet) => record(24, [0, 0, sheet, 0, ...word(value * 2)])),
    ...sheetNames.flatMap(name => record(0x204, [...Array<number>(10).fill(0), ...Array.from(name, c => c.charCodeAt(0)), 0])),
    ...record(1)
  ]);
}

// Gnumeric lotus_parse_formula_new keeps both physical sheet endpoints when
// they differ, even when one endpoint is the formula's own sheet. LibreOffice
// ReadSRD also reads an independent sheet byte for every endpoint.
for (const id of [25, 40]) {
  it.each([
    [0, 2, 0, "=SUM('Last'!$A$1:'First\\'s'!$A$1)", 41],
    [2, 0, 2, "=SUM('First\\'s'!$A$1:'Last'!$A$1)", 41],
    [1, 0, 2, "=SUM('First\\'s'!$A$1:'Last'!$A$1)", 41],
    [0, 0, 0, "=SUM($A$1:$A$1)", 11],
    [0, 2, 2, "=SUM('Last'!$A$1:'Last'!$A$1)", 17],
  ] as const)(`preserves both sheet endpoints in Lotus record ${id}, owner %i, span %i:%i`, async (owner, first, last, formula, value) => {
    const book = await readLotus(input(id, owner, first, last), context);
    const cell = book.sheets[owner]!.cells.find(c => c.formula !== undefined)!;
    const result = recalculateWorkbook(book, context, true);
    expect(result.sheets[owner]!.cells.find(c => c.formula !== undefined)!.value).toEqual({ kind: "number", value });
    expect(cell.formula).toBe(formula);
  });
}
