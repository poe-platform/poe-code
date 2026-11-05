import { expect, it } from "vitest";
import type { CapabilityContext } from "../contracts.js";
import { recalculateWorkbook } from "./evaluator.js";

const context: CapabilityContext = {
  signal: new AbortController().signal,
  environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 100000, outputBytes: 100000, cells: 100, sheets: 10, operations: 100, workbookWork: 100000 },
  clock: { now: () => Date.UTC(2024, 0, 1) }, own() {}
};

it.each([undefined, "General", "0.00", "dd-mmm-yyyy"])("preserves explicit formatting %s when calculating dates", format => {
  for (const dateSystem of ["1900", "1904"] as const) {
    const book = recalculateWorkbook({ dateSystem, sheets: [{ id: "s", name: "S", cells: [{
      row: 0, column: 0, formula: "=DATE(2024,2,29)", formulaDirty: true,
      value: { kind: "blank" }, ...(format === undefined ? {} : { format })
    }] }] }, context);
    const cell = book.sheets[0]!.cells[0]!;
    expect(cell.format).toBe(!format || format === "General" ? "yyyy/mm/dd" : format);
    expect(cell.value).toEqual({ kind: "number", value: dateSystem === "1900" ? 45351 : 43889 });
    expect(cell.cachedResult).toEqual(cell.value);
  }
});
