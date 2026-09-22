import assert from "node:assert/strict";
import { test } from "node:test";
import { CsvParser, selectColumns, serializeRow, CsvBudget } from "./index.js";
const enc = new TextEncoder();
const signal = new AbortController().signal;
test("every byte split preserves quoted multiline cells and physical positions", () => {
  const bytes = enc.encode('\ufeffx,y\r\n"é\r\nq",a\r\nb\r\n');
  for (let split = 0; split <= bytes.length; split++) {
    const parser = new CsvParser({}, new CsvBudget({}, signal));
    const rows = [
      ...parser.push(bytes.subarray(0, split)),
      ...parser.push(bytes.subarray(split)),
      ...parser.end()
    ];
    assert.deepEqual(rows, [
      { cells: ["x", "y"], line: 1 },
      { cells: ["é\r\nq", "a"], line: 3 },
      { cells: ["b"], line: 4 }
    ]);
  }
});
test("selectors are positions first, exact names before ranges, ordered and untrimmed", () => {
  const b = new CsvBudget({}, signal);
  assert.deepEqual(selectColumns("2,x,x,a-b", ["2", "x", "x", "a-b"], false, b), [1, 1, 1, 3]);
  assert.deepEqual(selectColumns("1-2,1", ["a", "b"], false, b), [0, 1, 0]);
  assert.throws(() => selectColumns(" x", ["x"], false, b));
});
test("comma LF serialization converts each CR and preserves short rows", () => {
  assert.equal(serializeRow(["a\r\nb", '"', ""], new CsvBudget({}, signal)), '"a\n\nb","""",\n');
  assert.equal(serializeRow(["a"], new CsvBudget({}, signal)), "a\n");
});
test("decoding, input, decoded, retention and work limits are local", () => {
  assert.throws(() =>
    new CsvParser({}, new CsvBudget({ inputBytes: 1 }, signal)).push(enc.encode("ab"))
  );
  assert.throws(() =>
    new CsvParser({}, new CsvBudget({ decodedBytes: 1 }, signal)).push(enc.encode("ab"))
  );
  assert.throws(() =>
    new CsvParser({}, new CsvBudget({ retainedBytes: 1 }, signal)).push(enc.encode("ab"))
  );
  assert.throws(() => new CsvParser({}, new CsvBudget({ work: 1 }, signal)).push(enc.encode("ab")));
  assert.throws(() => new CsvParser({}, new CsvBudget({}, signal)).push(Uint8Array.of(255)));
  assert.deepEqual(new CsvParser({}, new CsvBudget({}, signal)).push(enc.encode("a\n")), [
    { cells: ["a"], line: 1 }
  ]);
});
test("numeric syntax is decimal, and skipped physical lines precede parser line numbers", () => {
  const b = new CsvBudget({}, signal);
  assert.throws(() => selectColumns("0x2", ["a", "b"], false, b));
  const parser = new CsvParser({ skipLines: 1 }, new CsvBudget({}, signal));
  assert.deepEqual(parser.push(enc.encode("ignored\r\nx\r\na\r\n")), [
    { cells: ["x"], line: 1 },
    { cells: ["a"], line: 2 }
  ]);
});
test("selector header hashing charges all decoded header units", () => {
  assert.throws(
    () =>
      selectColumns(
        "x",
        [...Array.from({ length: 50 }, () => "y".repeat(40)), "x"],
        false,
        new CsvBudget({ work: 100 }, signal)
      ),
    { code: "LIMIT" }
  );
});
test("selector split storage is admitted before token allocation", () => {
  assert.throws(
    () => selectColumns("x", ["x"], false, new CsvBudget({ retainedBytes: 100 }, signal)),
    { code: "LIMIT" }
  );
});
test("large decimal numeric headers remain positional selectors rather than exact names", () => {
  for (const value of ["9007199254740993", "9".repeat(400)])
    assert.throws(() => selectColumns(value, [value], false, new CsvBudget({}, signal)), {
      code: "INPUT"
    });
});
test("permissive-v1 quoted EOF reports consumed physical lines, not next-line position", () => {
  for (const ending of ["\n", "\r", "\r\n"]) {
    const parser = new CsvParser({}, new CsvBudget({}, signal));
    assert.deepEqual(
      [...parser.push(enc.encode('x\n"abc' + ending)), ...parser.end()],
      [
        { cells: ["x"], line: 1 },
        { cells: ["abc" + ending], line: 2 }
      ]
    );
  }
});
