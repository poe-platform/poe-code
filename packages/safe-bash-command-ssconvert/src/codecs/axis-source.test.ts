import { expect, it } from "vitest";
import type { Workbook } from "@poe-code/spreadsheet-ast";
import { defaultSsconvertLimits, type CapabilityContext } from "@poe-code/spreadsheet-engine";
import { createXlsxStreamWriter } from "./xlsx.js";
import { createOdfStreamWriter } from "./odf.js";
import { writeGnumericStream, writeCompressedGnumericStream } from "./gnumeric.js";

const book: Workbook = { sheets: [{ id: "s", name: "Data", size: { rows: 128, columns: 128 },
  rows: [{ index: 4, hidden: true, sizePoints: 17 }, { index: 0, sizePoints: 23 }],
  columns: [{ index: 2, sizePoints: 42, outlineLevel: 1 }],
  cells: [{ row: 0, column: 0, value: { kind: "number", value: 1 } }] }] };
const source = { metadata: { ...book, sheets: book.sheets.map(sheet => ({ ...sheet, cells: [], rows: [], columns: [] })) },
  async *cells(id: string) { yield* book.sheets.find(sheet => sheet.id === id)!.cells; },
  async *axes(id: string, kind: "rows" | "columns") { yield* book.sheets.find(sheet => sheet.id === id)![kind]!; } };

it.each(["xlsx2006", "xlsx2008", "ods-strict", "ods-extended", "gnumeric", "gnumeric-gzip"])("preserves streamed axis metadata for direct %s export", async kind => {
  const context: CapabilityContext = { limits: defaultSsconvertLimits, signal: new AbortController().signal,
    environment: { env: {}, locale: "C", timezone: "UTC" }, own() {} };
  const writer = kind === "gnumeric-gzip" ? writeCompressedGnumericStream : kind === "gnumeric" ? writeGnumericStream : kind.startsWith("xlsx") ? createXlsxStreamWriter(kind === "xlsx2006" ? "2006" : "2008") : createOdfStreamWriter(kind === "ods-strict" ? "strict" : "extended");
  async function bytes(input: typeof source | Workbook) {
    const chunks: Uint8Array[] = [];
    const stream = "metadata" in input ? writer(input, [], context) : writer(input, [], context);
    for await (const chunk of stream) chunks.push(chunk.slice());
    return Buffer.concat(chunks);
  }
  expect(await bytes(source)).toEqual(await bytes(book));
});
