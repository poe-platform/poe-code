import assert from "node:assert/strict";
import { test } from "node:test";
import { CsvBudget, CsvParser, serializeRow } from "./index.js";

for (const size of [2048, 4096]) {
  for (const unit of ["a", "é", "😀", '"', "\r"]) {
    test(`cell accounting stays linear for ${JSON.stringify(unit)} repeated ${size} times`, () => {
      const cell = unit.repeat(size);
      const budget = new CsvBudget({ work: cell.length * 16, retainedBytes: cell.length * 32 }, new AbortController().signal);
      const parser = new CsvParser({}, budget);
      try {
        const csv = '"' + cell.replaceAll('"', '""') + '"\n';
        const rows = [...parser.push(new TextEncoder().encode(csv)), ...parser.end()];
        assert.deepEqual(rows.map(row => row.cells), [[cell]]);
        const normalized = cell.replaceAll("\r", "\n");
        const expected = unit === '"' || unit === "\r" ? '"' + normalized.replaceAll('"', '""') + '"\n' : normalized + "\n";
        assert.equal(serializeRow(rows[0]!.cells, budget), expected);
      } finally {
        parser.dispose();
        budget.dispose();
      }
    });
  }
}

test("wide rows serialize within a linear budget", () => {
  const budget = new CsvBudget({ work: 8192, retainedBytes: 32768 }, new AbortController().signal);
  try {
    assert.equal(serializeRow(Array<string>(2048).fill("x"), budget), "x,".repeat(2047) + "x\n");
  } finally { budget.dispose(); }
});

test("linear append charges still enforce the whole field limit across chunks", () => {
  const budget = new CsvBudget({ fieldBytes: 8 }, new AbortController().signal);
  const parser = new CsvParser({}, budget);
  try {
    parser.push(new TextEncoder().encode("abcd"));
    assert.throws(() => parser.push(new TextEncoder().encode("e")), { code: "LIMIT", message: "Field byte limit exceeded" });
  } finally { parser.dispose(); budget.dispose(); }
});
