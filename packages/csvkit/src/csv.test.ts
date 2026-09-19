import { test } from "vitest";
import assert from "node:assert/strict";
import { readCsv, writeCsvRow } from "./csv.js";

// CPython 3.14.2 csv.reader / Agate 1.14.2 Writer, frozen C profile.
test("CSV reader retains physical line numbers, blank rows and forgiving quotes", () => {
  assert.deepEqual([...readCsv('a,b\r\n"x\r\ny",z\r\n\r\n"q"tail,\n')], [
    { cells: ["a", "b"], line: 1 }, { cells: ["x\ny", "z"], line: 3 },
    { cells: [], line: 4 }, { cells: ["qtail", ""], line: 5 }
  ]);
  assert.deepEqual([...readCsv('"unfinished')], [{ cells: ["unfinished"], line: 1 }]);
});
test("CSV reader handles escaped newlines, spaces and quote-none", () => {
  assert.deepEqual([...readCsv(' a, "b,b",c\\\nd\n', { escapechar: "\\", skipinitialspace: true })], [
    { cells: ["a", "b,b", "c\nd"], line: 2 }
  ]);
  assert.deepEqual([...readCsv('"a",b', { quoting: 3 })], [{ cells: ['"a"', "b"], line: 1 }]);
});
test("CSV reader EOF line numbers count physical lines without inventing a trailing line", () => {
  for (const ending of ["\n", "\r", "\r\n"]) {
    assert.deepEqual([...readCsv('"a' + ending)], [{ cells: ["a\n"], line: 1 }]);
    assert.deepEqual([...readCsv('"a' + ending + ending)], [{ cells: ["a\n\n"], line: 2 }]);
    assert.deepEqual([...readCsv('a\\' + ending, { escapechar: "\\" })], [{ cells: ["a\n"], line: 1 }]);
  }
});
test("CSV reader treats the first nonseparator after a closing quote as literal text", () => {
  assert.deepEqual([...readCsv('"a"\\,b\n', { escapechar: "\\" })], [{ cells: ["a\\", "b"], line: 1 }]);
  assert.deepEqual([...readCsv('"a"\\', { escapechar: "\\" })], [{ cells: ["a\\"], line: 1 }]);
  assert.deepEqual([...readCsv('"a"\\\\', { escapechar: "\\" })], [{ cells: ["a\\\n"], line: 1 }]);
});
test("space-delimited readers skip repeated leading and interfield spaces", () => {
  assert.deepEqual([...readCsv('  a  b \n', { delimiter: " ", skipinitialspace: true })], [{ cells: ["a", "b", ""], line: 1 }]);
  assert.deepEqual([...readCsv(' ', { delimiter: " ", skipinitialspace: true })], [{ cells: [""], line: 1 }]);
});
test("space-delimited writers quote empty fields when initial spaces would be skipped", () => {
  const dialect = { delimiter: " ", skipinitialspace: true };
  assert.equal(writeCsvRow(["", "a", null], dialect), '"" a ""\n');
  for (const quoting of [3, 4, 5]) {
    assert.throws(() => writeCsvRow([null, "a"], { ...dialect, quoting }), error => error instanceof Error && error.message === "Error: empty field must be quoted if delimiter is a space and skipinitialspace is true");
  }
});
test("Agate writer normalizes CR and quotes the single empty field", () => {
  assert.equal(writeCsvRow(["a\rb", '"q"', "", null]), '"a\nb","""q""",,\n');
  assert.equal(writeCsvRow([""]), '""\n');
  assert.equal(writeCsvRow([]), '\n');
  assert.equal(writeCsvRow(["a", "b,c"], { delimiter: "\t", quoting: 1 }), '"a"\t"b,c"\n');
});
test("CSV dialect and field limits reject instead of silently changing input", () => {
  assert.throws(() => [...readCsv("abcd", { fieldLimit: 3 })], /FieldSizeLimitError/);
  assert.throws(() => [...readCsv("a", { delimiter: "xx" })], /unicode character/);
  assert.throws(() => writeCsvRow(["a,b"], { quoting: 3 }), /escape/);
  assert.equal(writeCsvRow(["a,b"], { quoting: 3, escapechar: "\\" }), "a\\,b\n");
});
test("frozen CSV dialect admission rejects line endings, colliding characters and skipped spaces", () => {
  const cases = [
    [{ delimiter: "" }, 'TypeError: "delimiter" must be a unicode character, not a string of length 0'],
    [{ delimiter: "\n" }, "ValueError: bad delimiter value"],
    [{ quotechar: "\r" }, "ValueError: bad quotechar value"],
    [{ escapechar: "\n" }, "ValueError: bad escapechar value"],
    [{ quotechar: "," }, "ValueError: bad delimiter or quotechar value"],
    [{ escapechar: "," }, "ValueError: bad delimiter or escapechar value"],
    [{ escapechar: '"' }, "ValueError: bad escapechar or quotechar value"],
    [{ quotechar: " ", skipinitialspace: true }, "ValueError: bad quotechar value"],
    [{ escapechar: " ", skipinitialspace: true }, "ValueError: bad escapechar value"]
  ] as const;
  for (const [dialect, message] of cases) {
    assert.throws(() => [...readCsv("", dialect)], error => error instanceof Error && error.message === message);
    assert.throws(() => writeCsvRow([], dialect), error => error instanceof Error && error.message === message);
  }
});
