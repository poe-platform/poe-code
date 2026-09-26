import { test } from "vitest";
import assert from "node:assert/strict";
import { readCsvStream, type CsvCell, type CsvDialect, type CsvRecord } from "./csv.js";

async function records(lines: readonly string[], dialect: CsvDialect = {}): Promise<CsvRecord<CsvCell>[]> {
  async function* input() { yield* lines; }
  const result: CsvRecord<CsvCell>[] = [];
  for await (const row of readCsvStream(input(), dialect)) result.push(row);
  return result;
}

// Differential observations: hash-pinned CPython 3.14.2 csv.reader, escapechar='\\'.
test("CSV stress: physical iterable boundaries finish unquoted and empty records", async () => {
  assert.deepEqual(await records(["a", "b"]), [
    { cells: ["a"], line: 1 }, { cells: ["b"], line: 2 }
  ]);
  assert.deepEqual(await records(["", "a\n", ""]), [
    { cells: [], line: 1 }, { cells: ["a"], line: 2 }, { cells: [], line: 3 }
  ]);
});

test("CSV stress: numeric stream conversion waits for quoted multiline completion", async () => {
  assert.deepEqual(await records(['1,"2\n', '3",,١_٢.٥\n'], { quoting: 2 }), [
    { cells: [1, "2\n3", "", 12.5], line: 2 }
  ]);
  assert.deepEqual(await records([',"",1,"2"\n'], { quoting: 4 }), [
    { cells: [null, "", 1, "2"], line: 1 }
  ]);
  assert.deepEqual(await records([',"",1,"2"\n'], { quoting: 5 }), [
    { cells: [null, "", "1", "2"], line: 1 }
  ]);
});

test("CSV stress: physical boundaries distinguish quoted and escaped continuation", async () => {
  assert.deepEqual(await records(['"a', 'b"']), [{ cells: ["ab"], line: 2 }]);
  assert.deepEqual(await records(["a\\", "b"], { escapechar: "\\" }), [{ cells: ["a\nb"], line: 2 }]);
  assert.deepEqual(await records(["a\\\n", "b\n"], { escapechar: "\\" }), [{ cells: ["a\nb"], line: 2 }]);
});

test("CSV stress: escaped CR remains literal while following LF terminates unquoted input", async () => {
  assert.deepEqual(await records(["a\\\r\n", "b\n"], { escapechar: "\\" }), [
    { cells: ["a\r"], line: 1 }, { cells: ["b"], line: 2 }
  ]);
  assert.deepEqual(await records(['"a\\\r\n', 'b"\n'], { escapechar: "\\" }), [
    { cells: ["a\r\nb"], line: 2 }
  ]);
});

test("CSV stress: newline tails are accepted but unquoted data after a newline is rejected", async () => {
  for (const ending of ["\r\n", "\r\r", "\n\n"])
    assert.deepEqual(await records(["a" + ending]), [{ cells: ["a"], line: 1 }]);
  await assert.rejects(records(["a\nb"]), error => error instanceof Error && error.message === "Error: new-line character seen in unquoted field - do you need to open the file with newline=''?");
});

test("CSV stress: field limits count Unicode characters and report the iterable physical line", async () => {
  assert.deepEqual(await records(['"😀', 'é"🦄z\n'], { delimiter: "🦄", fieldLimit: 2 }), [
    { cells: ["😀é", "z"], line: 2 }
  ]);
  await assert.rejects(records(['"😀\n', 'é"\n'], { fieldLimit: 2 }), error =>
    error instanceof Error && error.message === "FieldSizeLimitError: CSV contains a field longer than the maximum length of 2 characters on line 2. Try raising the maximum with the field_size_limit parameter, or try setting quoting=csv.QUOTE_NONE.");
});

test("CSV stress: stopping after a row closes upstream without reading another item", async () => {
  let read = 0;
  let closed = false;
  async function* input() {
    try { read++; yield "a\n"; read++; yield "b\n"; }
    finally { closed = true; }
  }
  for await (const row of readCsvStream(input())) {
    assert.deepEqual(row, { cells: ["a"], line: 1 });
    break;
  }
  assert.equal(read, 1);
  assert.equal(closed, true);
});
