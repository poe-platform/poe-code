import { expect, it } from "vitest";
import type { CapabilityContext } from "../contracts.js";
import { recalculateWorkbook } from "../formulas/evaluator.js";
import { readLotus } from "./lotus.js";

const context: CapabilityContext = {
  signal: new AbortController().signal, own() {},
  environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 10000, outputBytes: 10000, cells: 100, sheets: 4, operations: 1000 }
};
const word = (value: number) => [value & 255, value >>> 8];
const record = (id: number, data: number[] = []) => [...word(id), ...word(data.length), ...data];
function formulaFixture(version: number, tokens: number[]): Uint8Array {
  const modern = version >= 0x1000;
  return Uint8Array.from([
    ...record(0, [...word(version), ...(modern ? [4, 0, ...Array<number>(22).fill(0)] : [])]),
    ...(modern ? record(25, [0, 0, 0, 0, ...Array<number>(10).fill(0), ...tokens])
      : record(16, [...Array<number>(13).fill(0), ...word(tokens.length), ...tokens])),
    ...record(1)
  ]);
}
function fixture(version: number, named: boolean): Uint8Array {
  const number = (n: number) => [5, ...word(version >= 0x1000 ? n * 2 : n)];
  const name = Array.from("@<<@123>>YEAR(", c => c.charCodeAt(0));
  return formulaFixture(version, [...number(124), ...number(1), ...number(1), 54,
    ...(named ? [0x7a, 1, ...word(name.length), ...name] : [62]), 3]);
}

it.each([[0x404, false], [0x1000, false], [0x1002, false], [0x1002, true]] as const)(
  "imports Lotus YEAR as years since 1900 (version %i, named %s)", async (version, named) => {
    // LibreOffice LotusToSc::DoFunc subtracts 1900 for ocGetYear, including add-ins.
    const book = await readLotus(fixture(version, named), context);
    expect(book.sheets[0]!.cells[0]!.formula).toBe("=(YEAR(DATE(124,1,1))-1900)");
    const result = recalculateWorkbook(book, context, true);
    expect(result.sheets[0]!.cells[0]!.value).toEqual({ kind: "number", value: 124 });
  }
);

for (const [version, named] of [[0x404, false], [0x1000, false], [0x1002, true]] as const) {
  it.each([
    { name: "CHOOSE", opcode: 48, args: [0, "first", "second"], formula: '=CHOOSE((0+1),"first","second")', value: "first" },
    { name: "MID", opcode: 73, args: ["abcd", 0, 2], formula: '=MID("abcd",(0+1),2)', value: "ab" },
    { name: "REPLACE", opcode: 106, args: ["abcd", 0, 2, "X"], formula: '=REPLACE("abcd",(0+1),2,"X")', value: "Xcd" },
    { name: "FIND", opcode: 76, args: ["b", "abc", 0], formula: '=(FIND("b","abc",(0+1))-1)', value: 1 },
    { name: "STRING", opcode: 72, args: [1234, 2], formula: '=FIXED(1234,2,TRUE())', value: "1234.00" },
    { name: "PMT", opcode: 56, args: [100, 0, 10], formula: '=PMT(0,10,-(100))', value: 10 },
    { name: "PV", opcode: 57, args: [10, 0, 10], formula: '=PV(0,10,-(10))', value: 100 },
    { name: "FV", opcode: 58, args: [10, 0, 10], formula: '=FV(0,10,-(10))', value: 100 },
    { name: "RATE", opcode: 116, args: [200, 100, 1], formula: '=RATE(1,0,-(100),200)', value: 1 },
    { name: "TERM", opcode: 117, args: [10, 0, 100], formula: '=NPER(0,-(10),0,100)', value: 10 },
    { name: "CTERM", opcode: 118, args: [1, 200, 100], formula: '=NPER(1,0,-(100),200)', value: 1 },
  ])(`imports Lotus $name argument conventions (version ${version}, named ${named})`, async item => {
    // LibreOffice DoFunc and Gnumeric wk1_fin_func define these operand conversions.
    const tokens = item.args.flatMap(arg => typeof arg === "number"
      ? [5, ...word(version >= 0x1000 ? arg * 2 : arg)]
      : [6, ...Array.from(arg, c => c.charCodeAt(0)), 0]);
    const name = Array.from(`@<<@123>>${item.name}(`, c => c.charCodeAt(0));
    tokens.push(...(named ? [0x7a, item.args.length, ...word(name.length), ...name]
      : [item.opcode, ...(item.name === "CHOOSE" ? [item.args.length] : [])]), 3);
    const book = await readLotus(formulaFixture(version, tokens), context);
    expect(book.sheets[0]!.cells[0]!.formula).toBe(item.formula);
    const result = recalculateWorkbook(book, context, true);
    expect(result.sheets[0]!.cells[0]!.value).toEqual(typeof item.value === "number"
      ? { kind: "number", value: expect.closeTo(item.value, 12) } : { kind: "string", value: item.value });
  });
}

it.each([false, true])("imports Lotus IRR guess/range order (named %s)", async named => {
  const name = Array.from("@<<@123>>IRR(", c => c.charCodeAt(0));
  const tokens = [5, ...word(2), 2, 0, ...word(1), 0, 0, ...word(2), 0, 0,
    ...(named ? [0x7a, 2, ...word(name.length), ...name] : [89]), 3];
  const initial = formulaFixture(0x1002, tokens);
  const cells = [-100, 200].flatMap((value, index) => record(25,
    [...word(index + 1), 0, 0, ...Array<number>(10).fill(0), 5, ...word(Math.abs(value) * 2), ...(value < 0 ? [14] : []), 3]));
  const book = await readLotus(Uint8Array.from([...initial.subarray(0, -4), ...cells, ...record(1)]), context);
  expect(book.sheets[0]!.cells[0]!.formula).toBe("=IRR($A$2:$A$3,1)");
  expect(recalculateWorkbook(book, context, true).sheets[0]!.cells[0]!.value)
    .toEqual({ kind: "number", value: expect.closeTo(1, 12) });
});
