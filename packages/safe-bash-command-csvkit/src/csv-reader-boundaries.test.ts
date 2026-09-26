import assert from "node:assert/strict";
import { test } from "vitest";
import { readCsvStream, type CsvRecord } from "./csv.js";

async function rows(lines: readonly string[]): Promise<CsvRecord[]> {
  async function* input() { yield* lines; }
  const result: CsvRecord[] = [];
  for await (const row of readCsvStream(input(), { escapechar: "\\" })) result.push(row);
  return result;
}

// CPython 3.14.2 csv.reader observations: AFTER_ESCAPED_CRNL persists until
// a delimiter, another escape or an actual unescaped newline changes state.
test("escaped newline continuation survives empty physical iterator items", async () => {
  assert.deepEqual(await rows(["a\\\n", "", ",\n"]), [
    { cells: ["a\n", ""], line: 3 }
  ]);
});

test("escaped newline continuation survives ordinary text before the iterator boundary", async () => {
  for (const newline of ["\r", "\n"]) {
    assert.deepEqual(await rows(["a\\" + newline + "b", "c\n"]), [
      { cells: ["a" + newline + "bc"], line: 2 }
    ]);
  }
});

test("delimiter ends escaped newline continuation before an empty iterator item", async () => {
  assert.deepEqual(await rows(["a\\\nb,", "", "c\n"]), [
    { cells: ["a\nb", ""], line: 1 }, { cells: [], line: 2 }, { cells: ["c"], line: 3 }
  ]);
});
