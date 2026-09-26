import { describe, expect, it } from "vitest";
import type { CapabilityContext } from "../contracts.js";
import type { Workbook } from "../workbook.js";
import { prepareToolTest } from "./protocol.js";
import { runAnalysisTool } from "./run.js";

function context(overrides: Partial<CapabilityContext> = {}): CapabilityContext {
  return { signal: new AbortController().signal, environment: { env: {}, locale: "C", timezone: "UTC" },
    limits: { inputBytes: 1000, outputBytes: 10000, cells: 100, sheets: 10, operations: 1000 }, own() {}, ...overrides };
}
function fixture(): Workbook {
  return { activeSheet: "input", sheets: [{ id: "input", name: "Sample Data", cells: [
    { row: 0, column: 0, value: { kind: "string", value: "First" } },
    { row: 0, column: 1, value: { kind: "string", value: "Second" } },
    ...[2, 4, 8, 10].flatMap((value, index) => [
      { row: index + 1, column: 0, value: { kind: "number" as const, value } },
      { row: index + 1, column: 1, value: { kind: "number" as const, value: value * 10 } }
    ])] }] };
}
async function run(book: Workbook, args: readonly string[], ctx = context()) {
  return runAnalysisTool(book, await prepareToolTest(book, ["moving-average", ...args], ctx), ctx);
}

describe("independent moving-average runner stress", () => {
  it("normalizes the native reversed label-only data window before admitting output", async () => {
    const result = await run(fixture(), ["data:A1", "labels:yes"]);
    expect(result.sheets[1]!.cells.map(cell => cell.formula)).toEqual([
      "=index('Sample Data'!$A$1)",
      "=average(offset('Sample Data'!$A$1:$A$2,0,0,1,1))",
      "=average(offset('Sample Data'!$A$1:$A$2,1,0,1,1))"
    ]);
    await expect(run(fixture(), ["data:A1", "labels:yes"], context({ limits: { ...context().limits, cells: 12 } })))
      .rejects.toMatchObject({ code: "resource-limit" });
    const rows = await run(fixture(), ["data:A1", "labels:yes", "group-by:row"]);
    expect(rows.sheets[1]!.cells.map(cell => cell.formula)).toEqual([
      "=index('Sample Data'!$A$1)",
      "=average(offset('Sample Data'!$A$1:$B$1,0,0,1,1))",
      "=average(offset('Sample Data'!$A$1:$B$1,0,1,1,1))"
    ]);
  });
  it("calculates independent labeled columns while preserving source and activating the generated output", async () => {
    const book = fixture(), original = structuredClone(book);
    const result = await run(book, ["data:A1:B5", "labels:yes", "interval:2", "formulas:no"]);
    expect(book).toEqual(original);
    expect(book.activeSheet).toBe("input");
    expect(result.activeSheet).toBe(result.sheets[1]!.id);
    expect(result.sheets[0]).toEqual(original.sheets[0]);
    expect(result.sheets[1]!.cells.map(cell => cell.value)).toEqual([
      { kind: "string", value: "First" }, { kind: "error", value: "#N/A" },
      { kind: "number", value: 3 }, { kind: "number", value: 6 }, { kind: "number", value: 9 },
      { kind: "string", value: "Second" }, { kind: "error", value: "#N/A" },
      { kind: "number", value: 30 }, { kind: "number", value: 60 }, { kind: "number", value: 90 }]);
    expect(result.sheets[1]!.cells.every(cell => cell.formula === undefined && cell.formulaDirty === undefined && cell.cachedResult === undefined)).toBe(true);
  });

  it("renders row grouping formulas with horizontal moving windows", async () => {
    const result = await run(fixture(), ["data:A2:B3", "group-by:row", "interval:2"]);
    expect(result.sheets[1]!.cells).toEqual([
      { row: 0, column: 0, value: { kind: "string", value: "Row 1" } },
      { row: 1, column: 0, value: { kind: "error", value: "#N/A" } },
      { row: 2, column: 0, value: { kind: "blank" }, formula: "=average(offset('Sample Data'!$A$2:$B$2,0,0,1,2))", formulaDirty: true },
      { row: 0, column: 1, value: { kind: "string", value: "Row 2" } },
      { row: 1, column: 1, value: { kind: "error", value: "#N/A" } },
      { row: 2, column: 1, value: { kind: "blank" }, formula: "=average(offset('Sample Data'!$A$3:$B$3,0,0,1,2))", formulaDirty: true }
    ]);
  });

  it("matches native area and bin grouping as one column of windows over the original rectangle", async () => {
    for (const group of ["area", "bin"]) {
      const result = await run(fixture(), ["data:A2:B5", `group-by:${group}`, "interval:2"]);
      expect(result.sheets[1]!.cells).toHaveLength(5);
      expect(result.sheets[1]!.cells[0]!.value).toEqual({ kind: "string", value: "Column 1" });
      expect(result.sheets[1]!.cells[2]!.formula).toBe("=average(offset('Sample Data'!$A$2:$B$5,0,0,2,1))");
      expect(result.sheets[1]!.cells.every(cell => cell.column === 0)).toBe(true);
    }
  });

  it("produces one empty output sheet when data is absent or malformed", async () => {
    for (const args of [[], ["data:bogus"]]) {
      const result = await run(fixture(), args);
      expect(result.sheets).toHaveLength(2);
      expect(result.sheets[1]!.name).toBe("Moving Average (1)");
      expect(result.sheets[1]!.cells).toEqual([]);
    }
  });

  it("rejects output exceeding sheet or cell budgets before generating output", async () => {
    const book = fixture();
    for (const limits of [{ ...context().limits, sheets: 1 }, { ...context().limits, cells: 19 }]) {
      await expect(run(book, ["data:A1:B5", "labels:yes"], context({ limits }))).rejects.toMatchObject({ code: "resource-limit" });
      expect(book.sheets).toHaveLength(1);
    }
    const admitted = await run(book, ["data:A1:B5", "labels:yes"], context({ limits: { ...context().limits, cells: 20 } }));
    expect(admitted.sheets[1]!.cells).toHaveLength(10);
  });

  it("admits output against all retained cells including detached sheets", async () => {
    const book: Workbook = { ...fixture(), detachedSheets: [{ id: "detached", name: "Hidden retained data", cells: [
      { row: 0, column: 0, value: { kind: "number", value: 100 } }
    ] }] };
    await expect(run(book, ["data:A2:A5"], context({ limits: { ...context().limits, cells: 15 } })))
      .rejects.toMatchObject({ code: "resource-limit" });
    await expect(run(book, ["data:A2:A5"], context({ limits: { ...context().limits, sheets: 2 } })))
      .rejects.toMatchObject({ code: "resource-limit" });
    expect(book.detachedSheets?.[0]?.cells).toHaveLength(1);
  });

  it("supports numerical variants while rejecting unsupported graphs and sheet spans honestly", async () => {
    for (const arg of ["ma-type:1", "ma-type:2", "ma-type:3", "ma-type:4", "std-error-flag:1"]) {
      const result = await run(fixture(), ["data:A2:A5", arg]);
      expect(result.sheets).toHaveLength(2);
      expect(result.sheets[1]!.cells.length).toBe(arg === "std-error-flag:1" ? 10 : 5);
      expect(result.sheets[1]!.cells.filter(cell => cell.row > 0).every(cell => cell.formula !== undefined || cell.value.kind === "error")).toBe(true);
    }
    await expect(run(fixture(), ["data:A2:A5", "show-graph:yes"])).rejects.toMatchObject({ code: "unsupported-feature" });
    const book = fixture(), ctx = context();
    const request = await prepareToolTest(book, ["moving-average", "data:A2:A5"], ctx);
    await expect(runAnalysisTool(book, { ...request, toolOptions: { ...request.toolOptions!, data: { ...request.toolOptions!.data!, endSheet: "other" } } }, ctx))
      .rejects.toMatchObject({ code: "unsupported-feature" });
  });

  it("preserves exact abort reason and does not mutate source", async () => {
    const book = fixture(), original = structuredClone(book), controller = new AbortController(), ctx = context({ signal: controller.signal });
    const request = await prepareToolTest(book, ["moving-average", "data:A2:A5"], ctx);
    const reason = new Error("stop analysis");
    controller.abort(reason);
    await expect(runAnalysisTool(book, request, ctx)).rejects.toBe(reason);
    expect(book).toEqual(original);
  });

  it("resolves new sheet IDs independently of sheet-name collision rules", async () => {
    const input = fixture();
    const book: Workbook = { ...input, sheets: [...input.sheets, { id: "Moving Average (1)", name: "Unrelated", cells: [] }] };
    const first = await run(book, ["data:A2:A5"]);
    expect(first.sheets[2]!.name).toBe("Moving Average (1)");
    expect(first.sheets[2]!.id).toBe("Moving Average (1)_");
    const second = await run(first, ["data:A2:A5"]);
    expect(second.sheets[3]!.name).toBe("Moving Average (2)");
  });

  it("preserves ID uniqueness across retained detached sheets", async () => {
    const book: Workbook = { ...fixture(), detachedSheets: [{ id: "Moving Average (1)", name: "Detached", cells: [] }] };
    const result = await run(book, ["data:A2:A5"]);
    expect(result.sheets[1]!.id).toBe("Moving Average (1)_");
    expect(result.detachedSheets).toEqual(book.detachedSheets);
  });
});
