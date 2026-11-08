import { expect, it } from "vitest";
import { recalculateWorkbook } from "./evaluator.js";
import type { CapabilityContext } from "../contracts.js";
const context: CapabilityContext = { signal: new AbortController().signal, environment: { env: {}, locale: "C", timezone: "UTC" }, limits: { inputBytes: 100000, outputBytes: 100000, cells: 1000, sheets: 10, operations: 100, workbookWork: 100000 }, own() {} };
function calculate(formula: string) { return recalculateWorkbook({ sheets: [{ id: "s", name: "S", cells: [{ row: 0, column: 0, formula, value: { kind: "blank" }, formulaDirty: true }] }] }, context).sheets[0]!.cells[0]!.value; }
it.each(["OPT_BS", "OPT_BS_DELTA", "OPT_BS_THETA", "OPT_BS_RHO", "OPT_BS_CARRYCOST", "OPT_GARMAN_KOHLHAGEN", "OPT_FRENCH", "OPT_JUMP_DIFF", "OPT_EXEC", "OPT_BJER_STENS", "OPT_MILTERSEN_SCHWARTZ", "OPT_BAW_AMER", "OPT_FORWARD_START", "OPT_TIME_SWITCH", "OPT_ON_OPTIONS", "OPT_EXTENDIBLE_WRITER", "OPT_2_ASSET_CORRELATION", "OPT_SPREAD_APPROX", "OPT_FLOAT_STRK_LKBK", "OPT_FIXED_STRK_LKBK"])("validates option side in %s", name => {
  const count: Record<string, number> = { OPT_BS: 5, OPT_BS_DELTA: 5, OPT_BS_THETA: 5, OPT_BS_RHO: 5, OPT_BS_CARRYCOST: 5, OPT_GARMAN_KOHLHAGEN: 6, OPT_FRENCH: 7, OPT_JUMP_DIFF: 7, OPT_EXEC: 7, OPT_BJER_STENS: 6, OPT_MILTERSEN_SCHWARTZ: 13, OPT_BAW_AMER: 6, OPT_FORWARD_START: 7, OPT_TIME_SWITCH: 9, OPT_ON_OPTIONS: 8, OPT_EXTENDIBLE_WRITER: 8, OPT_2_ASSET_CORRELATION: 11, OPT_SPREAD_APPROX: 8, OPT_FLOAT_STRK_LKBK: 7, OPT_FIXED_STRK_LKBK: 8 };
  expect(calculate(`=${name}("invalid",${Array.from({ length: count[name]! }, () => "1").join(",")})`)).toEqual({ kind: "error", value: ["OPT_ON_OPTIONS", "OPT_FIXED_STRK_LKBK"].includes(name) ? "#VALUE!" : "#NUM!" });
});
it("matches put-call parity", () => {
  const result = calculate('=OPT_BS("c",120,100,1,0.05,0.2,0.05)-OPT_BS("p",120,100,1,0.05,0.2,0.05)');
  expect(result).toEqual({ kind: "number", value: expect.closeTo(120 - 100 * Math.exp(-.05), 10) });
});
it("rejects invalid binomial style", () => expect(calculate('=OPT_BINOMIAL("bad","c",10,100,100,1,.05,.2)')).toEqual({ kind: "error", value: "#NUM!" }));
