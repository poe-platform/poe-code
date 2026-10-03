import { expect, it } from "vitest";
import { createXlsxWriter, readXlsx } from "./xlsx.js";
import { defaultSsconvertLimits } from "@poe-code/spreadsheet-engine";
import type { CapabilityContext } from "@poe-code/spreadsheet-engine/contracts";
import type { Workbook } from "@poe-code/spreadsheet-ast";

it.each(["2006", "2008"] as const)("orders backed XLSX %s coordinates, rejects duplicates and overlays style blanks", async edition => {
  const region = (first: number, last: number, startCol: number, endCol: number, format: string) => ({
    name: "StyleRegion", attributes: { startRow: String(first), endRow: String(last), startCol: String(startCol), endCol: String(endCol) },
    children: [{ name: "Style", attributes: { Format: format }, children: [] }]
  });
  const book: Workbook = { sheets: [{ id: "s", name: "Data", rows: [{ index: 300, sizePoints: 20 }],
    cells: Array.from({ length: 257 }, (_, index) => ({ row: 256 - index, column: 2, value: { kind: "number" as const, value: index } })),
    unsupportedRecords: [{ source: "Gnumeric_XmlIO:sax", kind: "Styles", disposition: "retained", data: {
      name: "Styles", children: [region(100, 110, 0, 1, "0.000"), region(105, 115, 1, 2, "0.00")]
    } }]
  }] };
  const context: CapabilityContext = { signal: new AbortController().signal, limits: defaultSsconvertLimits,
    environment: { env: {}, locale: "C", timezone: "UTC" }, own() {} };
  await expect(createXlsxWriter(edition)({ ...book, sheets: [{ ...book.sheets[0]!, cells: [...book.sheets[0]!.cells,
    { row: 3, column: 2, value: { kind: "number", value: 999 } }] }] }, [], context)).rejects.toThrow("Duplicate cell address");
  const expected = await createXlsxWriter(edition)(book, [], context);
  const backing = new Uint8Array(2 * 1024 * 1024), borrowed = new Uint8Array(16384);
  let end = 8, closed = 0, reads = 0;
  const actual = await createXlsxWriter(edition)(book, [], { ...context, createWorkingStorage() { return {
    allocate(length) { const position = end; end += length; expect(end).toBeLessThanOrEqual(backing.length); return position; },
    async read(position, length) { reads++; expect(length).toBeLessThanOrEqual(16384); borrowed.fill(0); borrowed.set(backing.subarray(position, position + length)); return borrowed.subarray(0, length); },
    async write(position, bytes) { expect(bytes.length).toBeLessThanOrEqual(16384); backing.set(bytes, position); },
    async close() { closed++; }
  }; } });
  expect(actual).toEqual(expected); expect(closed).toBe(1); expect(reads).toBeGreaterThan(0);
  const restored = await readXlsx(actual, context), cells = restored.sheets[0]!.cells;
  expect(cells.find(cell => cell.row === 3 && cell.column === 2)?.value).toMatchObject({ kind: "number", value: 253 });
  expect(cells.find(cell => cell.row === 107 && cell.column === 1)?.format).toBe("0.000");
  expect(cells.find(cell => cell.row === 115 && cell.column === 1)?.format).toBe("0.00");
});
