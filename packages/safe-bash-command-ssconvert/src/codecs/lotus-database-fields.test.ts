import { expect, it } from "vitest";
import type { CapabilityContext } from "../contracts.js";
import { readLotus } from "./lotus.js";
import { recalculateWorkbook } from "../formulas/evaluator.js";

const context: CapabilityContext = { signal: new AbortController().signal, own() {},
  environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 10000, outputBytes: 10000, cells: 100, sheets: 2, operations: 1000 } };
const word = (value: number) => [value & 255, value >>> 8];
const record = (id: number, data: number[] = []) => [...word(id), ...word(data.length), ...data];
const text = (value: string) => [...Array.from(value, c => c.charCodeAt(0)), 0];

// #3478 requires zero-based Lotus database field offsets. Gnumeric's standard
// function hook currently forwards these operands unchanged.
for (const [version, named] of [[0x404, false], [0x1000, false], [0x1002, true]] as const) {
  it.each([
    [91, "DSUM", "DSUM", 126], [92, "DAVG", "DAVERAGE", 63],
    [93, "DCNT", "DCOUNTA", 2], [94, "DMIN", "DMIN", 42],
    [95, "DMAX", "DMAX", 84], [96, "DVAR", "DVARP", 441],
    [97, "DSTD", "DSTDEVP", 21], [243, "DPURECOUNT", "DCOUNT", 2],
  ] as const)(`converts database field zero for %i/%s (version ${version}, named ${named})`, async (opcode, name, target, value) => {
    const modern = version >= 0x1000;
    const range = (column: number, first: number, last: number) => modern
      ? [2, 0, ...word(first), 0, column, ...word(last), 0, column]
      : [2, ...word(column), ...word(first), ...word(column), ...word(last)];
    const label = (column: number, row: number, value: string) => modern
      ? record(22, [...word(row), 0, column, 39, ...text(value)])
      : record(15, [0, ...word(column), ...word(row), 39, ...text(value)]);
    const number = (row: number, value: number) => modern
      ? record(24, [...word(row), 0, 0, ...word(value * 2)])
      : record(13, [0, ...word(0), ...word(row), ...word(value)]);
    const functionName = text(`@<<@123>>${name}(`).slice(0, -1);
    const tokens = [...range(0, 1, 3), 5, ...word(0), ...range(3, 1, 2),
      ...(named ? [0x7a, 3, ...word(functionName.length), ...functionName] : [opcode, 3]), 3];
    const bytes = Uint8Array.from([...record(0, [...word(version), ...(modern ? [4, 0, ...Array<number>(22).fill(0)] : [])]),
      ...(modern ? record(25, [...Array<number>(14).fill(0), ...tokens])
        : record(16, [...Array<number>(13).fill(0), ...word(tokens.length), ...tokens])),
      ...label(0, 1, "Value"), ...number(2, 42), ...number(3, 84),
      ...label(3, 1, "Value"), ...label(3, 2, ">0"), ...record(1)]);
    const book = await readLotus(bytes, context);
    expect(book.sheets[0]!.cells[0]!.formula).toBe(`=${target}($A$2:$A$4,(0+1),$D$2:$D$3)`);
    expect(recalculateWorkbook(book, context, true).sheets[0]!.cells[0]!.value).toEqual({ kind: "number", value });
  });
}
