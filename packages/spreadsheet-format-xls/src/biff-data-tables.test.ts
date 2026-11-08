import { expect, test } from "vitest";
import { Binary } from "./biff-binary.js";
import { readBiffDataTable, writeBiffDataTable } from "./biff-data-tables.js";
import type { CapabilityContext } from "@poe-code/spreadsheet-engine/contracts";
import type { Workbook } from "@poe-code/spreadsheet-ast";

const context: CapabilityContext = { signal: new AbortController().signal, own() {},
  environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 100000, outputBytes: 100000, cells: 100, sheets: 4, operations: 10000 } };
const book: Workbook = { sheets: [{ id: "s", name: "Sheet", cells: [] }] };

test.each([0, 1, 65535])("BIFF8 ignores deleted input coordinates %s", coordinate => {
  const bytes = new Uint8Array(16), data = new DataView(bytes.buffer);
  data.setUint16(6, 0x38, true);
  for (const offset of [8, 10, 12, 14]) data.setUint16(offset, coordinate, true);
  expect(readBiffDataTable(new Binary(bytes), 8, 0x236)).toBe("=TABLE(#REF!,#REF!)");
  data.setUint16(6, 8, true);
  if (coordinate > 255) expect(() => readBiffDataTable(new Binary(bytes), 8, 0x236)).toThrow("invalid data-table input cell");
});

test.each(["=TABLE((E1),($F$1))", "=(TABLE(((E1)),(($F$1))))"])("BIFF exports parenthesized inputs: %s", expression => {
  const bytes = writeBiffDataTable({ id: "t", kind: "array", expression,
    range: { startRow: 1, endRow: 2, startColumn: 1, endColumn: 2 } }, "s", book, context, 65536)!;
  expect(readBiffDataTable(new Binary(bytes), 8, 0x236)).toBe("=TABLE(E1,F1)");
});

test.each(["=TABLE(@row:E1,)", "=TABLE((@column:E1),F1)"])("BIFF refuses label inputs: %s", expression => {
  expect(() => writeBiffDataTable({ id: "t", kind: "array", expression,
    range: { startRow: 1, endRow: 2, startColumn: 1, endColumn: 2 } }, "s", book, context, 65536))
    .toThrow("Cannot export Excel data table input expression");
});
