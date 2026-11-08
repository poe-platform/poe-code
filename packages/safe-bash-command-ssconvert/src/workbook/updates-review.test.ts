import { describe, expect, it } from "vitest";
import { SsconvertError, type CapabilityContext } from "../contracts.js";
import type { Workbook } from "../workbook.js";
import { setCellText } from "./updates/index.js";
import { recalculateWorkbook } from "./updates/recalculation.js";

const n = (value: number) => ({ kind: "number" as const, value });
function context(): CapabilityContext {
  return { signal: new AbortController().signal, own() {},
    environment: { env: {}, locale: "C", timezone: "UTC" },
    limits: { cells: 100, sheets: 5, inputBytes: 10000, outputBytes: 10000, operations: 50 } };
}
function scopedBook(): Workbook {
  return { names: [
    { name: "Rate", expression: "=Other!Rate", position: { sheet: "other", row: 0, column: 0 } },
    { name: "Rate", sheet: "other", expression: "=Other!$A$1" }
  ], sheets: [
    { id: "main", name: "Main", cells: [{ row: 0, column: 0, formula: "=Rate+1", value: n(3), cachedResult: n(3) }] },
    { id: "other", name: "Other", cells: [{ row: 0, column: 0, value: n(2) }] }
  ] };
}
describe("independent scoped-name and admission review", () => {
  it("distinguishes a workbook name from its same-spelled sheet-local dependency", () => {
    const original = scopedBook();
    const updated = setCellText(original,
      { sheet: "other", startRow: 0, endRow: 0, startColumn: 0, endColumn: 0 }, "8", context());
    expect(updated.sheets[0]!.cells[0]).toMatchObject({ formulaDirty: true, cachedResult: n(3) });
    expect(recalculateWorkbook(updated, context()).sheets[0]!.cells[0])
      .toMatchObject({ formulaDirty: false, cachedResult: n(9) });
    expect(original.sheets[0]!.cells[0]!.cachedResult).toEqual(n(3));
  });
  it("also evaluates same-spelled scoped names during forced recalculation", () => {
    expect(recalculateWorkbook(scopedBook(), context(), true).sheets[0]!.cells[0]!.cachedResult).toEqual(n(3));
  });
  it("still detects an actual named-expression cycle", () => {
    const book = scopedBook();
    const circular = { ...book, names: [{ name: "Rate", expression: "=rAtE" }] };
    expect(recalculateWorkbook(circular, context(), true).sheets[0]!.cells[0]!.cachedResult)
      .toEqual({ kind: "error", value: "#NAME?" });
  });
  it("preserves the workbook on work-budget rejection", () => {
    const book = scopedBook(), ctx = context();
    expect(() => recalculateWorkbook(book, { ...ctx, limits: { ...ctx.limits, workbookWork: 1 } }, true))
      .toThrowError(new SsconvertError("resource-limit", "ssconvert workbook work limit exceeded"));
    expect(book.sheets[0]!.cells[0]).toEqual({ row: 0, column: 0, formula: "=Rate+1", value: n(3), cachedResult: n(3) });
  });
  it("retains abort-reason identity before forced calculation", () => {
    const ctx = context(), controller = new AbortController(), reason = { stop: true };
    controller.abort(reason);
    expect(() => recalculateWorkbook(scopedBook(), { ...ctx, signal: controller.signal }, true)).toThrow(reason);
  });
});
