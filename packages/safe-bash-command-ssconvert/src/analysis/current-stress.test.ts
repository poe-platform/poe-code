import { describe, expect, it } from "vitest";
import type { CapabilityContext } from "../contracts.js";
import type { Workbook } from "../workbook.js";
import { prepareToolTest } from "./protocol.js";
import { runAnalysisTool } from "./run.js";

function context(): CapabilityContext {
  return { signal: new AbortController().signal, environment: { env: {}, locale: "C", timezone: "UTC" },
    limits: { inputBytes: 1000, outputBytes: 10000, cells: 100, sheets: 10, operations: 100 }, own() {} };
}
const input: Workbook = { activeSheet: "s", sheets: [{ id: "s", name: "Input", cells: [
  { row: 0, column: 0, value: { kind: "string", value: "Weight" } },
  { row: 1, column: 0, value: { kind: "number", value: 2 } },
  { row: 2, column: 0, value: { kind: "number", value: 4 } }
] }] };
async function run(args: readonly string[]) {
  const ctx = context();
  return runAnalysisTool(input, await prepareToolTest(input, ["moving-average", "data:A1:A3", ...args], ctx), ctx);
}

describe("current independent analysis stress", () => {
  it("clips output to selected sheet dimensions while retaining original moving-window bounds", async () => {
    const book: Workbook = { activeSheet: "s", sheets: [
      { id: "s", name: "Small", size: { rows: 128, columns: 256 }, cells: [] },
      { id: "l", name: "Large", size: { rows: 256, columns: 256 }, cells: [] }
    ] };
    const ctx = { ...context(), limits: { ...context().limits, cells: 128 } };
    const request = await prepareToolTest(book, ["moving-average", "data:Large!A1:A129", "offset:1"], ctx);
    const result = await runAnalysisTool(book, request, ctx);
    expect(result.sheets[2]!.size).toEqual({ rows: 128, columns: 256 });
    expect(result.sheets[2]!.cells).toHaveLength(128);
    expect(result.sheets[2]!.cells.at(-1)!.formula).toBe("=average(offset(Large!$A$1:$A$129,127,0,1,1))");
    expect(book.sheets).toHaveLength(2);
    await expect(runAnalysisTool(book, request, { ...ctx, limits: { ...ctx.limits, cells: 127 } }))
      .rejects.toMatchObject({ code: "resource-limit" });
    const invalid = await prepareToolTest(book, ["moving-average", "data:A1:A129"], ctx);
    expect(invalid.toolOptions?.data).toBeUndefined();
    expect((await runAnalysisTool(book, invalid, ctx)).sheets[2]!.cells).toEqual([]);
  });
  it("clips grouped columns from a larger explicit source without reducing input window dimensions", async () => {
    const book: Workbook = { activeSheet: "s", sheets: [
      { id: "s", name: "Small", size: { rows: 128, columns: 256 }, cells: [] },
      { id: "l", name: "Large", size: { rows: 128, columns: 512 }, cells: [] }
    ] };
    const ctx = { ...context(), limits: { ...context().limits, cells: 512 } };
    const request = await prepareToolTest(book, ["moving-average", "data:Large!A1:IW1"], ctx);
    const result = await runAnalysisTool(book, request, ctx);
    expect(result.sheets[2]!.cells).toHaveLength(512);
    expect(result.sheets[2]!.cells.at(-1)).toMatchObject({ row: 1, column: 255,
      formula: "=average(offset(Large!$IV$1,0,0,1,1))" });
    expect(result.sheets[2]!.cells.every(cell => cell.column < 256)).toBe(true);
  });
  it("sets italic on labeled headings and preserves that style when formulas are materialized", async () => {
    for (const formulas of ["yes", "no"]) {
      const result = await run(["labels:yes", `formulas:${formulas}`]);
      expect(result.sheets[1]!.cells[0]!.style).toMatchObject({ italic: true });
      expect(result.sheets[1]!.cells.slice(1).every(cell => cell.style?.italic !== true)).toBe(true);
      expect(result.sheets[0]).toEqual(input.sheets[0]);
    }
    const unlabeled = await run(["labels:no"]);
    expect(unlabeled.sheets[1]!.cells.every(cell => cell.style?.italic !== true)).toBe(true);
  });
});
