import { describe, expect, it } from "vitest";
import { snapshotRecords, snapshotWorkbook } from "./model.js";

const limits = { inputBytes: 1000, outputBytes: 1000, cells: 10, sheets: 3, operations: 10 };

describe("workbook hidden own-property admission", () => {
  it("denies a hidden accessor without executing it or losing it silently", () => {
    let calls = 0;
    const properties = Object.defineProperty({}, "secret", {
      get() {
        calls++;
        return () => {};
      }
    });
    expect(() => snapshotWorkbook({ sheets: [], properties }, limits)).toThrow("accessor");
    expect(calls).toBe(0);
  });

  it("preserves hidden data fields rather than converting present cells to missing cells", () => {
    const properties = Object.defineProperty({}, "title", { value: "表🧪" });
    expect(snapshotRecords(properties, limits)).toEqual({ title: "表🧪" });
    const cells = Object.defineProperty([], "0", {
      value: { row: 0, column: 0, value: { kind: "blank" } }
    });
    expect(snapshotWorkbook({ sheets: [{ id: "s", name: "s", cells }] }, limits).sheets[0]?.cells)
      .toEqual([{ row: 0, column: 0, value: { kind: "blank" } }]);
  });

  it("denies hidden custom array fields even when their values are ordinary data", () => {
    expect(() => snapshotRecords(Object.defineProperty([], "extra", { value: 1 }), limits))
      .toThrow("array");
  });

  it("keeps ordinary array length and null-prototype records admissible", () => {
    expect(snapshotRecords([Object.assign(Object.create(null), { title: "ok" })], limits))
      .toEqual([{ title: "ok" }]);
  });
});
