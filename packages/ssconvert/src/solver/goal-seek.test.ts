import { describe, expect, it } from "vitest";
import { runConversionTransforms } from "../conversion/transforms.js";
import type { CapabilityContext, EngineConfig } from "../contracts.js";
import type { Workbook } from "../workbook.js";
const config: EngineConfig = { codecs: [], environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { cells: 100, sheets: 4, operations: 20, inputBytes: 10000, outputBytes: 10000 } };
const context: CapabilityContext = { limits: config.limits, environment: config.environment,
  signal: new AbortController().signal, own() {} };
describe("hidden goal seek", () => {
  it("solves repeated five-cell strips in order and recalculates dependent reports", async () => {
    const book: Workbook = { sheets: [{ id: "s", name: "Sheet", cells: [
      { row: 0, column: 0, formula: "=B1*2", value: { kind: "number", value: 0 } },
      { row: 0, column: 1, value: { kind: "number", value: 1 } },
      { row: 0, column: 2, value: { kind: "number", value: 8 } },
      { row: 0, column: 5, formula: "=B1+G1", value: { kind: "number", value: 0 } },
      { row: 0, column: 6, value: { kind: "number", value: 1 } },
      { row: 0, column: 7, value: { kind: "number", value: 10 } },
      { row: 0, column: 10, formula: "=B1+G1", value: { kind: "number", value: 0 } }
    ] }] };
    const result = await runConversionTransforms(book, { input: { kind: "stream", source: [] },
      goalSeekExpressions: ["A1:E1", "F1:J1"] }, config, context, () => {});
    expect(result.book.sheets[0]!.cells.find(c => c.column === 1)!.value).toEqual({ kind: "number", value: 4 });
    // Native 1.12.61 writes 6.0000000000000009 in its XML (same IEEE double).
    expect(result.book.sheets[0]!.cells.find(c => c.column === 6)!.value).toEqual({ kind: "number", value: 6.000000000000001 });
    expect(result.book.sheets[0]!.cells.find(c => c.column === 10)!.value).toEqual({ kind: "number", value: 10 });
  });
});

it.each([
  ["A1", "dialog_goal_seek_test: assertion 'range->start.col + 4 == range->end.col' failed"],
  ["A1:E2", "dialog_goal_seek_test: assertion 'range->start.row == range->end.row' failed"],
  ["A1:D1", "dialog_goal_seek_test: assertion 'range->start.col + 4 == range->end.col' failed"],
  ["Other!A1:E1", "dialog_goal_seek: assertion 'start_sheet == sheet' failed"]
])("keeps native assertion content and continues for %s", async (expression, message) => {
  const notices: string[] = [], stages: string[] = [];
  const book: Workbook = { sheets: [{ id: "s", name: "Sheet", cells: [] }, { id: "o", name: "Other", cells: [] }] };
  const binding: EngineConfig = { ...config, solver: { async goalSeek(b) { return b; }, async solve(b) { stages.push("solve"); return b; } } };
  const result = await runConversionTransforms(book, { input: { kind: "stream", source: [] },
    goalSeekExpressions: [expression], solve: true }, binding, { ...context,
      async diagnostic(d) { notices.push(d.message); } }, () => {});
  expect(notices).toEqual([message]);
  expect(stages).toEqual(["solve"]);
  expect(result.book.sheets.map(s => s.cells)).toEqual([[], []]);
});

it("rejects invalid syntax before solver and export stages", async () => {
  const stages: string[] = [];
  const binding: EngineConfig = { ...config, solver: { async goalSeek(b) { return b; }, async solve(b) { stages.push("solve"); return b; } } };
  await expect(runConversionTransforms({ sheets: [{ id: "s", name: "Sheet", cells: [] }] },
    { input: { kind: "stream", source: [] }, goalSeekExpressions: ["bad"], solve: true }, binding, context, () => {}))
    .rejects.toMatchObject({ message: "Invalid range specified.", exitCode: 1 });
  expect(stages).toEqual([]);
});

it("retains the native spare normal sample across repeated ranges within one invocation", async () => {
  let draws = 0;
  const random = { next() { const n = draws++; return n === 100 || n === 202 ? .75 : n === 101 || n === 203 ? .6 : 0; } };
  const book: Workbook = { sheets: [{ id: "s", name: "Sheet", cells: [0, 1].flatMap(row => [
    { row, column: 0, formula: `=IF(B${row + 1}>0.1,0,1)`, value: { kind: "number" as const, value: 1 } },
    ...[0, 0, -1, 1].map((value, index) => ({ row, column: index + 1, value: { kind: "number" as const, value } }))
  ]) }] };
  const result = await runConversionTransforms(book, { input: { kind: "stream", source: [] },
    goalSeekExpressions: ["A1:E1", "A2:E2"] }, config, { ...context, random }, () => {});
  expect(draws).toBe(202);
  expect(result.book.sheets[0]!.cells.filter(c => c.column === 0).map(c => c.value)).toEqual([
    { kind: "number", value: 0 }, { kind: "number", value: 0 }
  ]);
});

it("writes failure into the changing input and continues to later ranges and reports", async () => {
  const book: Workbook = { sheets: [{ id: "s", name: "Sheet", cells: [0, 1].flatMap(row => [
    { row, column: 0, formula: `=B${row + 1}*2`, value: { kind: "number" as const, value: 2 } },
    ...[1, 8, row === 0 ? 10 : -10, row === 0 ? -10 : 10].map((value, index) => ({
      row, column: index + 1, value: { kind: "number" as const, value }
    }))
  ]) }] };
  const result = await runConversionTransforms(book, { input: { kind: "stream", source: [] },
    goalSeekExpressions: ["A1:E1", "A2:E2"] }, config, context, () => {});
  expect(result.book.sheets[0]!.cells.find(c => c.row === 0 && c.column === 1)!.value).toEqual({ kind: "error", value: "#VALUE!" });
  expect(result.book.sheets[0]!.cells.find(c => c.row === 0 && c.column === 0)!.value).toEqual({ kind: "error", value: "#VALUE!" });
  expect(result.book.sheets[0]!.cells.find(c => c.row === 1 && c.column === 1)!.value).toEqual({ kind: "number", value: 4 });
  expect(result.book.sheets[0]!.cells.find(c => c.row === 1 && c.column === 0)!.value).toEqual({ kind: "number", value: 8 });
});

it("resolves unqualified strips on the active sheet rather than the first sheet", async () => {
  const cells = [
    { row: 0, column: 0, formula: "=B1*2", value: { kind: "number" as const, value: 2 } },
    { row: 0, column: 1, value: { kind: "number" as const, value: 1 } },
    { row: 0, column: 2, value: { kind: "number" as const, value: 8 } }
  ];
  const result = await runConversionTransforms({ activeSheet: "second", sheets: [
    { id: "first", name: "First", cells }, { id: "second", name: "Second", cells }
  ] }, { input: { kind: "stream", source: [] }, goalSeekExpressions: ["A1:E1"] }, config, context, () => {});
  expect(result.book.activeSheet).toBe("second");
  expect(result.book.sheets[0]!.cells.find(c => c.column === 1)!.value).toEqual({ kind: "number", value: 1 });
  expect(result.book.sheets[1]!.cells.find(c => c.column === 1)!.value).toEqual({ kind: "number", value: 4 });
});
