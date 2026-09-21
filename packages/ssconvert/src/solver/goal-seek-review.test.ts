import { expect, it } from "vitest";
import { FinancialGoalSeek } from "../formulas/functions/financial-goal-seek.js";
import { goalSeekRange } from "./goal-seek.js";
import type { CapabilityContext } from "../contracts.js";
import type { CellValue, Workbook } from "../workbook.js";

const context: CapabilityContext = {
  environment: { env: {}, locale: "C", timezone: "UTC" }, signal: new AbortController().signal,
  limits: { cells: 100, sheets: 4, operations: 20, inputBytes: 10000, outputBytes: 10000, workbookWork: 10000 }, own() {}
};
const number = (value: number): CellValue => ({ kind: "number", value });
const strip = { sheet: "s", startRow: 0, endRow: 0, startColumn: 0, endColumn: 4 };
function book(initial: CellValue, target: CellValue, minimum: CellValue, maximum: CellValue): Workbook {
  return { sheets: [{ id: "s", name: "Sheet", cells: [
    { row: 0, column: 0, formula: "=B1", value: number(99) },
    ...[initial, target, minimum, maximum].map((value, index) => ({ row: 0, column: index + 1, value }))
  ] }] };
}

it("stops derivative evaluation after an invalid left-side result", () => {
  const visited: number[] = [];
  const search = new FinancialGoalSeek(x => { visited.push(x); return x < 0 ? NaN : 1; }, { tick() {} }, -1, 1);
  expect(search.newton(0)).toBe(false);
  // fake_df in released goal-seek.c returns the callback error before visiting xr.
  expect(visited).toEqual([0, -2e-6]);
});

it("normalizes a raw signed-zero input when writing a native numeric root", async () => {
  const result = await goalSeekRange(book({ kind: "string", value: "-0" }, number(0), number(-1), number(1)), strip, context);
  expect(result.sheets[0]!.cells.find(cell => cell.column === 1)!.value).toEqual(number(0));
});

it.each([
  ["inf", number(-1), { kind: "string", value: "inf" }],
  ["-inf", { kind: "string", value: "-inf" }, number(1)],
  ["nan", number(-1), { kind: "string", value: "nan" }]
] satisfies [string, CellValue, CellValue][])("maps a nonfinite accepted guess %s to the native numeric error for a constant target", async (initial, minimum, maximum) => {
  const input = book({ kind: "string", value: initial }, number(0), minimum, maximum);
  const result = await goalSeekRange({ ...input, sheets: [{ ...input.sheets[0]!, cells: input.sheets[0]!.cells.map(cell =>
    cell.column === 0 ? { ...cell, formula: "=0", value: number(0) } : cell) }] }, strip, context);
  // gnm_goal_seek_eval_cell writes value_new_float(nonfinite) (#NUM!), but constant y still meets zero.
  expect(result.sheets[0]!.cells.find(cell => cell.column === 1)!.value).toEqual({ kind: "error", value: "#NUM!" });
});

it.each([0, 7, -3])("accepts a target already attained at fixed bound %s", async value => {
  const result = await goalSeekRange(book(number(value), number(value), number(value), number(value)), strip, context);
  expect(result.sheets[0]!.cells.find(cell => cell.column === 1)!.value).toEqual(number(value));
});

it("fixed bounds with an unattained target still consume native uniform-trawl draws", async () => {
  let draws = 0;
  const result = await goalSeekRange(book(number(1), number(2), number(1), number(1)), strip,
    { ...context, random: { next() { draws++; return .25; } } });
  expect(result.sheets[0]!.cells.find(cell => cell.column === 1)!.value).toEqual({ kind: "error", value: "#VALUE!" });
  expect(draws).toBe(100);
});

it("trawls uniformly before normally when raw bounds parse as NaN", async () => {
  const input = book(number(1), number(0), { kind: "string", value: "nan" }, number(1));
  let evaluations = 0;
  const counts: number[] = [], stop = new Error("bounded trace complete");
  await expect(goalSeekRange({ ...input, sheets: [{ ...input.sheets[0]!, cells: input.sheets[0]!.cells.map(cell =>
    cell.column === 0 ? { ...cell, formula: "=IF(ISERROR(B1),'[authorized.xls]Sheet1'!A1,1)" } : cell) }] }, strip,
    { ...context, externalReferences: { resolve() { evaluations++; return number(1); } },
      random: { next() { counts.push(evaluations); if (counts.length === 2) throw stop; return .75; } } })).rejects.toBe(stop);
  // Each uniform draw is followed by f(x); normal generation consumes two draws first.
  expect(counts).toEqual([3, 4]);
});

it("C numeric prefixes ignore non-ASCII whitespace rather than applying JS trimming", async () => {
  const result = await goalSeekRange(book(number(0), { kind: "string", value: "\u00a02" }, number(0), number(0)), strip, context);
  expect(result.sheets[0]!.cells.find(cell => cell.column === 1)!.value).toEqual(number(0));
});

it("recalculates target dependencies on another sheet under manual calculation mode", async () => {
  const input = book(number(1), number(12), number(-10), number(10));
  const result = await goalSeekRange({ ...input, calculationMode: "manual", sheets: [
    { ...input.sheets[0]!, cells: input.sheets[0]!.cells.map(cell => cell.column === 0 ? { ...cell, formula: "=Other!A1" } : cell) },
    { id: "other", name: "Other", cells: [{ row: 0, column: 0, formula: "=Sheet!B1*3", value: number(99) }] }
  ] }, strip, context);
  expect(result.sheets[0]!.cells.find(cell => cell.column === 1)!.value).toEqual(number(4));
  expect(result.sheets[1]!.cells[0]!.value).toEqual(number(12));
});

it("enforces cumulative evaluation work rather than resetting between candidates", async () => {
  await expect(goalSeekRange(book(number(1), number(12), number(-10), number(10)), strip,
    { ...context, limits: { ...context.limits, workbookWork: 10 } })).rejects.toMatchObject({ code: "resource-limit" });
});

it("preserves the cancellation reason and does not call random after admission abort", async () => {
  const controller = new AbortController(), reason = { review: "owned cancellation" };
  controller.abort(reason);
  let draws = 0;
  await expect(goalSeekRange(book(number(1), number(2), number(-1), number(1)), strip,
    { ...context, signal: controller.signal, random: { next() { draws++; return .5; } } })).rejects.toBe(reason);
  expect(draws).toBe(0);
});
