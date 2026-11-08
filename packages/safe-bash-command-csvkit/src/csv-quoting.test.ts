import assert from "node:assert/strict";
import { test } from "vitest";
import { readCsv, writeCsvRow } from "./csv.js";

test("CPython numeric quoting converts only unquoted nonempty fields", () => {
  assert.deepEqual([...readCsv('1,"2",,١_٢.٥,-Infinity,nAn\n', { quoting: 2 })], [
    { cells: [1, "2", "", 12.5, -Infinity, NaN], line: 1 }
  ]);
  assert.deepEqual([...readCsv(',"",1,"2"\n', { quoting: 4 })], [
    { cells: [null, "", 1, "2"], line: 1 }
  ]);
  assert.deepEqual([...readCsv(',"",1,"2"\n', { quoting: 5 })], [
    { cells: [null, "", "1", "2"], line: 1 }
  ]);
});

test("numeric quoting rejects Python-invalid float syntax with the original value", () => {
  for (const field of ["name", "0x10", "1__0", "1_", "1e", "\u001c1"]) {
    assert.throws(() => [...readCsv(field, { quoting: 2 })], error =>
      error instanceof Error && error.message.startsWith("ValueError: could not convert string to float: "));
  }
  assert.deepEqual([...readCsv('  +.٥e٢  ,1_000,1.\n', { quoting: 2 })][0]?.cells, [50, 1000, 1]);
});

test("reader dialect validates quoting choices and supports disabled quote characters", () => {
  assert.throws(() => [...readCsv("", { quoting: 6 })], /bad "quoting" value/);
  assert.deepEqual([...readCsv('"a",b\n', { quotechar: null })][0]?.cells, ['"a"', "b"]);
  assert.deepEqual([...readCsv('a,b\n', { escapechar: null })][0]?.cells, ["a", "b"]);
  assert.deepEqual([...readCsv('a\0b,c\n', { quotechar: "\0" })][0]?.cells, ["a\0b", "c"]);
  assert.throws(() => [...readCsv("", { quotechar: null, quoting: 0 })], /quotechar must be set/);
});

test("disabled quote characters select quote-none for the shared writer dialect", () => {
  assert.throws(() => writeCsvRow(["a,b"], { quotechar: null }), /need to escape, but no escapechar set/);
  assert.equal(writeCsvRow(["a,b"], { quotechar: null, escapechar: "\\" }), "a\\,b\n");
});
