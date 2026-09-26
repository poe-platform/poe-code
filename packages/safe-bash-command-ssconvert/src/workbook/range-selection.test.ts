import { expect, it } from "vitest";
import { Volume } from "memfs";
import { createEngine, runCommand, type Codec, type Workbook } from "../index.js";
import { exportRangeForSheet, parseRangeExpression } from "./expressions.js";

const book: Workbook = { activeSheet: "b", sheets: [
  { id: "a", name: "First", cells: [], size: { rows: 128, columns: 128 } },
  { id: "b", name: "A= B", cells: [], size: { rows: 256, columns: 256 } },
  { id: "c", name: "Last", cells: [], size: { rows: 128, columns: 128 } }
] };

it("accepts whole-axis references under the released range grammar", () => {
  expect(parseRangeExpression("First!$B:$C", book)).toEqual({ sheet: "a",
    startRow: 0, endRow: 127, startColumn: 1, endColumn: 2 });
  expect(parseRangeExpression("First!$3:2", book)).toEqual({ sheet: "a",
    startRow: 1, endRow: 2, startColumn: 0, endColumn: 127 });
});

it("normalizes relative sheet-span endpoints against their respective dimensions", () => {
  const unequal: Workbook = { activeSheet: "b", sheets: [
    { ...book.sheets[0]!, size: { rows: 256, columns: 256 } },
    { ...book.sheets[1]!, size: { rows: 128, columns: 128 } }
  ] };
  // rangeref_parse copies singleton coordinates to b; position.c evaluates b
  // using the end sheet's dimensions before range_normalize.
  expect(parseRangeExpression("First:'A= B'!DY129", unequal)).toEqual({
    sheet: "a", endSheet: "b", startRow: 0, endRow: 128, startColumn: 0, endColumn: 128
  });
  expect(parseRangeExpression("First:'A= B'!$DY$129", unequal)).toEqual({
    sheet: "a", endSheet: "b", startRow: 128, endRow: 128, startColumn: 128, endColumn: 128
  });
  expect(parseRangeExpression("First:'A= B'!DY:EZ", unequal)).toEqual({
    sheet: "a", endSheet: "b", startRow: 0, endRow: 127, startColumn: 27, endColumn: 128
  });
});

it("binds a sheet-span's normalized coordinates to the sheet being exported", () => {
  const range = parseRangeExpression("First:Last!$B$2:A1", book);
  expect(exportRangeForSheet(range, book, "b")).toMatchObject({ sheet: "b",
    startRow: 0, endRow: 1, startColumn: 0, endColumn: 1 });
  expect(exportRangeForSheet(range, book, "missing")).toBeUndefined();
});

it("parses the set delimiter after a quoted sheet name containing equals", async () => {
  const volume = Volume.fromJSON({ "/input": "original", "/output": "keep" });
  const updates: unknown[] = [];
  const codec: Codec = { id: "fixture", description: "Original range fixture", extensions: [],
    probeContent: () => true, async read() { return book; }, async write() { return new Uint8Array([65]); } };
  const engine = createEngine({ codecs: [codec], environment: { env: {}, locale: "C", timezone: "UTC" },
    limits: { inputBytes: 100, outputBytes: 1000, cells: 100, sheets: 10, operations: 30 },
    filesystem: { async read(path) { return [new Uint8Array(volume.readFileSync(path) as Uint8Array)]; },
      async write(path, bytes) { volume.writeFileSync(path, bytes); } },
    cellText: { async setText(value, range, text) { updates.push({ range, text }); return value; } }
  });
  const errors: string[] = [];
  const result = await runCommand(["-T", "fixture", "--set='A= B'!$B$2:C3=hello=there", "--set=First!A1=active", "/input", "/output"], engine,
    { signal: new AbortController().signal, stdout: { async write() {} },
      stderr: { async write(bytes) { errors.push(new TextDecoder().decode(bytes)); } } });
  expect(result.exitCode).toBe(0);
  expect(errors).toEqual([]);
  expect(updates).toEqual([
    { range: { sheet: "b", startRow: 1, endRow: 2, startColumn: 1, endColumn: 2 }, text: "hello=there" },
    { range: { sheet: "b", startRow: 0, endRow: 0, startColumn: 0, endColumn: 0 }, text: "active" }
  ]);
  expect(volume.toJSON()).toEqual({ "/input": "original", "/output": "A" });
});
