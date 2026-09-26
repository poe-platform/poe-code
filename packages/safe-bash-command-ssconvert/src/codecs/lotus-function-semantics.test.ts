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

for (const version of [0x1002, 0x1003, 0x1004, 0x1005]) {
  it.each([0x19, 0x28])(`decodes numeric tokens by Lotus formula record (version ${version}, record %i)`, async id => {
    // LibreOffice OP_Formula123/FT_Const10Float and libwps readCell/readFormula:
    // record 0x28 uses binary64 plus 32-bit compact numbers, 0x19 uses 80/16 bits.
    const ieee = id === 0x28;
    const floating = ieee ? [0, 0, 0, 0, 0, 0, 4, 64] : [0, 0, 0, 0, 0, 0, 0, 160, 0, 64]; // 2.5
    const compact = ieee ? [192, 0, 0, 0] : [6, 0]; // 3
    const warnings: string[] = [];
    const bytes = Uint8Array.from([
      ...record(0, [...word(version), 4, 0, ...Array<number>(22).fill(0)]),
      ...record(id, [0, 0, 0, 0, ...Array<number>(ieee ? 8 : 10).fill(0), 0, ...floating, 5, ...compact, 15, 3]),
      ...record(1)
    ]);
    const book = await readLotus(bytes, { ...context, async diagnostic(d) { warnings.push(d.message); } });
    expect(book.sheets[0]!.cells[0]!.formula).toBe("=(2.5+3)");
    expect(recalculateWorkbook(book, context, true).sheets[0]!.cells[0]!.value).toEqual({ kind: "number", value: 5.5 });
    expect(warnings).toEqual([]);
  });
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

const x = { column: 0 }, y = { column: 1 };
it.each([
  { name: "ACOT", args: [1], formula: "=ACOT(1)", value: Math.PI / 4 },
  { name: "COT", args: [1], formula: "=COT(1)", value: 1 / Math.tan(1) },
  { name: "TRUNC", args: [123, -1], formula: "=TRUNC(123,-1)", value: 120 },
  { name: "CORREL", args: [x, y], formula: "=CORREL($A$2:$A$4,$B$2:$B$4)", value: 1 },
  { name: "MEDIAN", args: [x], formula: "=MEDIAN($A$2:$A$4)", value: 2 },
  { name: "COV", args: [x, y], formula: "=COVAR($A$2:$A$4,$B$2:$B$4)", value: 4 / 3 },
  { name: "CHITEST", args: [x, y], formula: "=CHITEST($A$2:$A$4,$B$2:$B$4)", value: Math.exp(-1.5) },
  { name: "FTEST", args: [x, y], formula: "=FTEST($A$2:$A$4,$B$2:$B$4)", value: 0.4 },
  { name: "PRODUCT", args: [x], formula: "=PRODUCT($A$2:$A$4)", value: 6 },
  { name: "PERMUT", args: [5, 2], formula: "=PERMUT(5,2)", value: 20 },
  { name: "POISSON", args: [0, 1, 1], formula: "=POISSON(0,1,1)", value: Math.exp(-1) },
  { name: "NORMAL", args: [0, 0, 1, 1], formula: "=NORMDIST(0,0,1,1)", value: 0.5 },
  { name: "CRITBINOMIAL", args: [2, 1, 1], formula: "=CRITBINOM(2,1,1)", value: 2 },
  { name: "SUMIF", args: [x, ">1", y], formula: '=SUMIF($A$2:$A$4,">1",$B$2:$B$4)', value: 10 },
  { name: "COUNTIF", args: [x, ">1"], formula: '=COUNTIF($A$2:$A$4,">1")', value: 2 },
  { name: "CSC", args: [1], formula: "=CSC(1)", value: 1 / Math.sin(1) },
  { name: "CSCH", args: [1], formula: "=CSCH(1)", value: 1 / Math.sinh(1) },
  { name: "LARGE", args: [x, 2], formula: "=LARGE($A$2:$A$4,2)", value: 2 },
  { name: "SMALL", args: [x, 2], formula: "=SMALL($A$2:$A$4,2)", value: 2 },
  { name: "MODULO", args: [5, 2], formula: "=MOD(5,2)", value: 1 },
  { name: "ROUNDDOWN", args: [123, -1, 0], formula: "=ROUNDDOWN(123,-1)", value: 120 },
  { name: "ROUNDUP", args: [123, -1, 0], formula: "=ROUNDUP(123,-1)", value: 130 },
  { name: "SEC", args: [0], formula: "=SEC(0)", value: 1 },
])("imports LibreOffice-recognized named Lotus $name", async item => {
  // Independent scalar/range outcomes cover the aliases absent from Gnumeric's table.
  const tokens = item.args.flatMap(arg => typeof arg === "number" ? [5, ...word(arg * 2)]
    : typeof arg === "string" ? [6, ...Array.from(arg, c => c.charCodeAt(0)), 0]
    : [2, 0, ...word(1), 0, arg.column, ...word(3), 0, arg.column]);
  const name = Array.from(`@<<@123>>${item.name}(`, c => c.charCodeAt(0));
  tokens.push(0x7a, item.args.length, ...word(name.length), ...name, 3);
  const initial = formulaFixture(0x1002, tokens);
  const cells = [1, 2, 3].flatMap(row => [0, 1].flatMap(col => record(24,
    [...word(row), 0, col, ...word(row * (col + 1) * 2)])));
  const book = await readLotus(Uint8Array.from([...initial.subarray(0, -4), ...cells, ...record(1)]), context);
  expect(book.sheets[0]!.cells[0]!.formula).toBe(item.formula);
  expect(recalculateWorkbook(book, context, true).sheets[0]!.cells[0]!.value)
    .toEqual({ kind: "number", value: expect.closeTo(item.value, 12) });
});

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

for (const version of [0x1000, 0x1002]) {
  it.each([
    [0x8000, -16384], [0xfffe, -1], [0x7ffe, 16383], [0x0001, 0],
    [0xfff1, -5000], [0xfff3, -500], [0xfff5, -0.05], [0xfff7, -0.005],
    [0xfff9, -0.0005], [0xfffb, -0.00005], [0xfffd, -0.0625], [0xffff, -0.015625],
  ])(`sign-extends compact Lotus formula numbers like cell records (version ${version}, raw %i)`, async (raw, expected) => {
    // LibreOffice reads FT_Snum as sal_Int16 before SnumToDouble shifts its mantissa.
    const initial = formulaFixture(version, [5, ...word(raw), 3]);
    const literal = record(24, [...word(1), 0, 0, ...word(raw)]);
    const book = await readLotus(Uint8Array.from([...initial.subarray(0, -4), ...literal, ...record(1)]), context);
    expect(book.sheets[0]!.cells[0]!.formula).toBe(`=${expected}`);
    const result = recalculateWorkbook(book, context, true);
    expect(result.sheets[0]!.cells.map(cell => cell.value)).toEqual([
      { kind: "number", value: expected }, { kind: "number", value: expected }
    ]);
  });
}

for (const [version, named] of [[0x404, false], [0x1000, false], [0x1002, true]] as const) {
  it.each([
    { name: "INDEX", opcode: 98, first: 1, last: 0, formula: '=INDEX($A$2:$B$3,(0+1),(1+1))', value: 10 },
    { name: "VLOOKUP", opcode: 85, first: 2, last: 1, formula: '=VLOOKUP(2,$A$2:$B$3,(1+1))', value: 20 },
    { name: "HLOOKUP", opcode: 90, first: 10, last: 1, formula: '=HLOOKUP(10,$A$2:$B$3,(1+1))', value: 20 },
  ])(`imports Lotus $name lookup indices (version ${version}, named ${named})`, async item => {
    // LibreOffice DoFunc increments lookup indices and swaps INDEX's column/row pair.
    const modern = version >= 0x1000;
    const number = (value: number) => [5, ...word(modern ? value * 2 : value)];
    const range = modern ? [2, 0, ...word(1), 0, 0, ...word(2), 0, 1]
      : [2, ...word(0), ...word(1), ...word(1), ...word(2)];
    const name = Array.from(`@<<@123>>${item.name}(`, c => c.charCodeAt(0));
    const operands = item.name === "INDEX" ? [...range, ...number(item.first)] : [...number(item.first), ...range];
    const tokens = [...operands, ...number(item.last),
      ...(named ? [0x7a, 3, ...word(name.length), ...name] : [item.opcode, ...(item.name === "INDEX" ? [3] : [])]), 3];
    const initial = formulaFixture(version, tokens);
    const cells = [[1, 0, 1], [1, 1, 10], [2, 0, 2], [2, 1, 20]].flatMap(([row, col, value]) => modern
      ? record(24, [...word(row!), 0, col!, ...word(value! * 2)])
      : record(13, [0, ...word(col!), ...word(row!), ...word(value!)]));
    const book = await readLotus(Uint8Array.from([...initial.subarray(0, -4), ...cells, ...record(1)]), context);
    expect(book.sheets[0]!.cells[0]!.formula).toBe(item.formula);
    expect(recalculateWorkbook(book, context, true).sheets[0]!.cells[0]!.value)
      .toEqual({ kind: "number", value: item.value });
  });
}
