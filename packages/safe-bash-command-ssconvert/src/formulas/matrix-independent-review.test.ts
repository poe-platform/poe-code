import { expect, it, vi } from "vitest";
import type { CapabilityContext } from "../contracts.js";
import { recalculateWorkbook } from "./evaluator.js";
import { matrixFunctions } from "./functions/matrix.js";
import type { FunctionHost, Matrix } from "./functions/types.js";

const context: CapabilityContext = { signal: new AbortController().signal,
  environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 10000, outputBytes: 10000, cells: 100, sheets: 2, operations: 100, workbookWork: 100000 }, own() {} };
function calculate(formula: string) {
  return recalculateWorkbook({ sheets: [{ id: "s", name: "Sheet", cells: [
    { row: 0, column: 0, formula, formulaDirty: true, value: { kind: "number", value: 0 } }
  ] }] }, context).sheets[0]!.cells[0]!.value;
}
it.each<[string, number | string]>([
  ['=MDETERM({"12tail",0;0,2})', 24],
  ['=MDETERM({"50%",0;0,2})', 100],
  ['=MDETERM({"0x1p2",0;0,2})', 0],
  ['=INDEX(CHOLESKY({0,0;0,1}),1,1)', 0],
  ['=INDEX(CHOLESKY({-1,0;0,1}),1,2)', 0],
  ['=INDEX(CHOLESKY({0,0;0,1}),2,2)', '#NUM!'],
  ['=INDEX(MPSEUDOINVERSE({1,0;0,0.01},0.02),2,2)', 0],
  ['=INDEX(MPSEUDOINVERSE({1,0;0,0.01},0.01),2,2)', 0],
  ['=MDETERM({1,1;1,1.0000000000000002})', Number.EPSILON],
  ['=INDEX(EIGEN({-2,0;0,2}),1,1)', 2],
  ['=MDETERM({"nan",0;0,2})', '#NUM!'],
  ['=MDETERM({"inf",0;0,2})', '#NUM!'],
  ['=INDEX(MINVERSE({1,1;1,1.0000000000000002}),1,1)', '#NUM!'],
  ['=INDEX(MPSEUDOINVERSE({1,1;0,0.02},0.015),2,2)', 50],
  ['=INDEX(MPSEUDOINVERSE({1,2;2,4}),1,1)', .04],
  ['=INDEX(MPSEUDOINVERSE({1,2;2,4}),2,2)', .16],
  ['=INDEX(MPSEUDOINVERSE({1,2,3;2,4,6}),3,2)', .08571428571428572],
  ['=INDEX(MINVERSE({2,1;1,2}),2,1)', -1 / 3],
])("independent matrix oracle case %s", (formula, expected) => {
  expect(calculate(formula)).toEqual({ kind: typeof expected === "string" ? "error" : "number", value: expected });
});

it("admits the larger eigen output before creating output cells", () => {
  const input: Matrix = { kind: "matrix", rows: [
    [{ kind: "number", value: 2 }, { kind: "number", value: 0 }],
    [{ kind: "number", value: 0 }, { kind: "number", value: 1 }]
  ] };
  const host = { context: { ...context, limits: { ...context.limits, cells: 4 } },
    matrix: () => input, tick() {} } as unknown as FunctionHost;
  const mapping = vi.spyOn(Number, "isFinite").mockImplementation(() => { throw new Error("output mapped before admission"); });
  try {
    expect(() => matrixFunctions.EIGEN!([input], host)).toThrow("ssconvert calculation array limit exceeded");
    expect(mapping).not.toHaveBeenCalled();
  } finally { mapping.mockRestore(); }
});
