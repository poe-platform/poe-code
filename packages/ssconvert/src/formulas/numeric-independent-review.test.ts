import { expect, it } from "vitest";
import { recalculateWorkbook } from "./evaluator.js";
import type { CapabilityContext } from "../contracts.js";
import { nextAfter } from "./functions/floating-point.js";
import { callFunction } from "./functions/registry.js";
import { numericFunctionDescriptors } from "./numeric-function-descriptors.js";
import type { FunctionHost } from "./functions/types.js";

const context: CapabilityContext = {
  signal: new AbortController().signal, environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 10000, outputBytes: 10000, cells: 100, sheets: 2, operations: 100, workbookWork: 100000 }, own() {}
};
function calculateNumericFormula(formula: string) {
  return recalculateWorkbook({ sheets: [{ id: "s", name: "Sheet", cells: [
    { row: 0, column: 0, formula, formulaDirty: true, value: { kind: "number", value: 0 } }
  ] }] }, context).sheets[0]!.cells[0]!.value;
}

it.each<[string, string | number | boolean]>([
  ['=DECIMAL("",10)', 0],
  ['=DECIMAL("1.5",10)', '#NUM!'],
  ['=DECIMAL(" 23",10)', '#NUM!'],
  ['=DECIMAL("00000000001",10)', '#NUM!'],
  ['=DECIMAL(23.7,10)', 23],
  ['=BITLSHIFT(3,63)', 2 ** 63],
  ['=BITRSHIFT(3,-63)', 2 ** 63],
  ['=BITLSHIFT(3,-0.1)', 1],
  ['=BITOR("ignored",FALSE)', 0],
  ['=BITAND("ignored")', '#VALUE!'],
  ['=NT_PHI(1)', 1],
  ['=NT_D(2.9999999999999996)', 2],
  ['=ISPRIME(-1)', false],
  ['=FLT.NEXTAFTER(1,TRUE)', 1],
  ['=BASE(-4503599627370496,2)', '0000000000'],
  ['=BASE(-4503599627370496,16)', '0000000000'],
  ['=DEC2BIN(-1,"3")', '1111111111'],
  ['=HEX2DEC("0xF")', 15],
  ['=DECIMAL("0XFE",16)', 254],
  ['=BASE(-1025,2)', '0000000000'],
  ['=BASE(-1048577,4)', '0000000000'],
  ['=DEC2BIN("TRUE")', '#VALUE!'],
  ['=BASE("FALSE",2)', '#VALUE!'],
  ['=BITAND(-1,1/0)', '#DIV/0!'],
  ['=BITOR(-1,NA())', '#N/A'],
  ['=BITXOR(4503599627370497,1/0)', '#DIV/0!'],
  ['=BITAND(-1,"ignore")', '#VALUE!'],
  ['=BITOR(-1,"ignore")', '#VALUE!'],
  ['=BITXOR(4503599627370497,"ignore")', '#VALUE!'],
])("independent source-derived boundary %s", (formula, expected) => {
  expect(calculateNumericFormula(formula)).toEqual({
    kind: typeof expected === "string" ? expected.startsWith("#") ? "error" : "string"
      : typeof expected === "boolean" ? "boolean" : "number", value: expected
  });
});

it("steps across signed zero and the subnormal-normal boundary", () => {
  expect(Object.is(nextAfter(Number.MIN_VALUE, -1), 0)).toBe(true);
  expect(Object.is(nextAfter(-Number.MIN_VALUE, 1), -0)).toBe(true);
  expect(Object.is(nextAfter(0, -0), -0)).toBe(true);
  expect(nextAfter(2 ** -1022, 0)).toBe(2 ** -1022 - Number.MIN_VALUE);
});

const arityHost = { evaluate() { throw new Error("invalid arity evaluated an argument"); } } as unknown as FunctionHost;
const arityCases = Object.entries(numericFunctionDescriptors).filter(([, descriptor]) => descriptor.signature !== null).map(([name, descriptor]) => {
  const signature = descriptor.signature!, count = signature.split("|").join("").length;
  const nodes = Array.from({ length: count + 1 }, () => ({ start: 0, end: 1, kind: "literal" as const, value: { kind: "number" as const, value: 0 } }));
  return { name, signature, result: callFunction(name, nodes, arityHost) };
});
it.each(arityCases.filter(row => row.result !== undefined))(
  "rejects excess and missing arguments before evaluation for implemented fixed descriptor $name", ({ name, signature, result }) => {
    expect(result).toEqual({ kind: "error", value: "#N/A" });
    if (signature.length && signature[0] !== "|") expect(callFunction(name, [], arityHost)).toEqual({ kind: "error", value: "#N/A" });
  }
);
it.skip.each(arityCases.filter(row => row.result === undefined))(
  "unsupported kernel arity remains unmeasured for $name", ({ name }) => { throw new Error(`Unsupported numeric kernel: ${name}`); }
);
