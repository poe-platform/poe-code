import { describe, expect, it, vi } from "vitest";
import { SsconvertError, type CapabilityContext } from "../contracts.js";
import type { Workbook } from "../workbook.js";
import { setCellText } from "./updates/index.js";
import { recalculateWorkbook } from "./updates/recalculation.js";
import { parseFormula } from "./updates/formula.js";

const number = (value: number) => ({ kind: "number" as const, value });
const book: Workbook = { sheets: [{ id: "s", name: "Sheet", cells: [
  { row: 0, column: 0, value: number(2) },
  { row: 0, column: 1, formula: "=A1+1", value: number(3), cachedResult: number(3) },
  { row: 0, column: 2, formula: "=B1+1", value: number(4), cachedResult: number(4) }
] }] };
const range = { sheet: "s", startRow: 0, endRow: 0, startColumn: 0, endColumn: 0 };
function context(signal = new AbortController().signal): CapabilityContext {
  return { signal, own() {}, environment: { env: {}, locale: "C", timezone: "UTC" },
    limits: { cells: 100, sheets: 5, inputBytes: 100_000, outputBytes: 100_000, operations: 50 } };
}

describe("independent cell-update stress", () => {
  it("clips populated ranges to active sheet bounds before cell admission", () => {
    const empty: Workbook = { sheets: [{ id: "s", name: "Small", size: { rows: 128, columns: 128 }, cells: [] }] };
    const ctx = context();
    const updated = setCellText(empty, { ...range, endRow: 128, endColumn: 128 }, "4",
      { ...ctx, limits: { ...ctx.limits, cells: 16384 } });
    expect(updated.sheets[0]!.cells).toHaveLength(16384);
    expect(updated.sheets[0]!.cells.at(-1)).toMatchObject({ row: 127, column: 127, value: number(4) });
  });
  it("preserves SyntaxError reasons from the name observer", () => {
    const reason = new SyntaxError("cancelled observer");
    expect(() => parseFormula("=Unknown", book, "s", () => { throw reason; })).toThrow(reason);
  });
  it.each(["123", "=A1+1", "TRUE", "2024-01-02", "'123"])
    ("uses the top-left text format for the complete range: %s", text => {
      const styled: Workbook = { sheets: [{ ...book.sheets[0]!, cells: book.sheets[0]!.cells.map((cell, index) =>
        index === 0 ? { ...cell, format: "@" } : cell) }] };
      const updated = setCellText(styled, { ...range, endColumn: 1 }, text, context());
      expect(updated.sheets[0]!.cells.slice(0, 2).map(cell => cell.value))
        .toEqual(Array(2).fill({ kind: "string", value: text.startsWith("'") ? text.slice(1) : text }));
      expect(updated.sheets[0]!.cells.slice(0, 2).map(cell => cell.formula)).toEqual([undefined, undefined]);
      expect(updated.names).toBeUndefined();
    });
  it("admits aggregate workbook capacity before range iteration", () => {
    const ctx = context(), cancellationChecks = vi.spyOn(ctx.signal, "throwIfAborted");
    const occupied: Workbook = { sheets: [book.sheets[0]!, { id: "other", name: "Other", cells: [] }] };
    expect(() => setCellText(occupied, { ...range, sheet: "other", endRow: 99 }, "4", ctx))
      .toThrowError(new SsconvertError("resource-limit", "ssconvert workbook storage limit exceeded"));
    expect(cancellationChecks).toHaveBeenCalledTimes(1);
  });
  it("does not charge overwritten cells as new storage", () => {
    const ctx = context();
    const updated = setCellText(book, range, "8", { ...ctx, limits: { ...ctx.limits, cells: 3 } });
    expect(updated.sheets[0]!.cells).toHaveLength(3);
    expect(updated.sheets[0]!.cells[0]!.value).toEqual(number(8));
  });
  it.each(["++A1", "--A1"])("keeps repeated sign prefix %s as literal text", text => {
    expect(setCellText(book, range, text, context()).sheets[0]!.cells[0])
      .toMatchObject({ value: { kind: "string", value: text } });
  });
  it.each([
    [" true ", { kind: "string", value: " true " }, undefined],
    ["1,234", number(1234), undefined],
    ["$12", number(12), "$#,##0_);[Red]($#,##0)"],
    ["1/2/2024", number(45293), "m/d/yyyy"]
  ])("matches measured C-locale entry %s", (text, value, format) => {
    const cell = setCellText(book, range, text as string, context()).sheets[0]!.cells[0]!;
    expect(cell.value).toEqual(value);
    expect(cell.format).toEqual(format);
  });
  it.each([["+A1", "=A1", 2], ["-A1", "=-A1", -2], ["@A1", "=A1", 2]])
    ("recognizes measured formula introducer %s", (text, formula, value) => {
      const updated = setCellText(book, { ...range, startColumn: 1, endColumn: 1 }, text as string, context());
      expect(updated.sheets[0]!.cells[1]!.formula).toBe(formula);
      expect(recalculateWorkbook(updated, context()).sheets[0]!.cells[1]!.cachedResult).toEqual(number(value as number));
    });
  it("creates the native undefined-name placeholder namespace entry", () => {
    const updated = setCellText(book, { ...range, startColumn: 1, endColumn: 1 }, "=Unknown+1", context());
    expect(updated.names).toEqual([{ name: "Unknown", expression: "#NAME?" }]);
    expect(recalculateWorkbook(updated, context()).sheets[0]!.cells[1]!.cachedResult)
      .toEqual({ kind: "error", value: "#NAME?" });
    expect(book.names).toBeUndefined();
  });
  it("retains reached-name parser effects when later formula syntax fails", () => {
    const updated = setCellText(book, range, "=Unknown+", context());
    expect(updated.sheets[0]!.cells[0]!.value).toEqual({ kind: "string", value: "=Unknown+" });
    expect(updated.names).toEqual([{ name: "Unknown", expression: "#NAME?" }]);
    expect(setCellText(book, range, "=*Unreached", context()).names).toBeUndefined();
    expect(book.names).toBeUndefined();
  });
  it("rejects flat formulas before recursive AST work exhausts the host stack", () => {
    expect(() => setCellText(book, range, "=" + Array(100_000).fill("1").join("+"), context()))
      .toThrowError(new SsconvertError("resource-limit", "ssconvert formula depth limit exceeded"));
  });
  it("preserves abort reason identity and leaves source cells unchanged", () => {
    const controller = new AbortController(), reason = { cancelled: true };
    controller.abort(reason);
    expect(() => setCellText(book, range, "9", context(controller.signal))).toThrow(reason);
    expect(book.sheets[0]!.cells[0]!.value).toEqual(number(2));
  });
  it("keeps original caches in manual mode and recalculates repeated dependent edits", () => {
    let updated = setCellText({ ...book, calculationMode: "manual" }, range, "8", context());
    updated = setCellText(updated, range, "10", context());
    const retained = recalculateWorkbook(updated, context());
    expect(retained.sheets[0]!.cells[1]).toMatchObject({ cachedResult: number(3), formulaDirty: true });
    expect(recalculateWorkbook(retained, context(), true).sheets[0]!.cells[2])
      .toMatchObject({ cachedResult: number(12), formulaDirty: false });
  });
  it("relocates mixed absolute and relative references across a two-dimensional range", () => {
    const updated = setCellText(book, { ...range, startRow: 1, endRow: 2, startColumn: 3, endColumn: 4 },
      "=$A1+B$1+$C$1", context());
    expect(updated.sheets[0]!.cells.filter(cell => cell.row > 0).map(cell => cell.formula))
      .toEqual(["=$A1+B$1+$C$1", "=$A1+C$1+$C$1", "=$A2+B$1+$C$1", "=$A2+C$1+$C$1"]);
  });
});
