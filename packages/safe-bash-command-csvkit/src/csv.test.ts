import { test } from "vitest";
import assert from "node:assert/strict";
import { readCsv, readCsvStream, writeCsvRow, type CsvRecord } from "./csv.js";

test("streamed plain CSV admits each row after its first character", async () => {
  for (const quoting of [0, 1, 3] as const) {
    let steps = 0;
    const admissions: number[] = [];
    const rows: CsvRecord[] = [];
    async function* lines() { yield "a,b\n"; yield "c,d\n"; }
    for await (const row of readCsvStream(lines(), { quoting }, () => { steps++; }, () => { admissions.push(steps); })) rows.push(row);
    assert.equal(steps, 8);
    assert.deepEqual(admissions, [1, 5]);
    assert.deepEqual(rows, [{ cells: ["a", "b"], line: 1 }, { cells: ["c", "d"], line: 2 }]);
  }
});

test("streamed plain CSV preserves a step failure after row admission", async () => {
  for (const reason of [false, new Error("step budget exhausted")]) {
    let steps = 0;
    let admissions = 0;
    let finalized = false;
    const rows: CsvRecord[] = [];
    async function* lines() { try { yield "a,b\n"; } finally { finalized = true; } }
    await assert.rejects(async () => {
      for await (const row of readCsvStream(lines(), {}, () => { if (++steps === 4) throw reason; }, () => { admissions++; })) rows.push(row);
    }, error => error === reason);
    assert.equal(steps, 4);
    assert.equal(admissions, 1);
    assert.equal(finalized, true);
    assert.deepEqual(rows, []);
  }
});

test("CSV row rejection precedes remaining character work on plain and general paths", async () => {
  for (const text of ["a,b\n", "é,b\n", '"a",b\n']) {
    let steps = 0;
    let finalized = false;
    const reason = new Error("row limit exceeded");
    async function* lines() { try { yield text; } finally { finalized = true; } }
    await assert.rejects(async () => {
      for await (const row of readCsvStream(lines(), {}, () => {
        if (++steps > 2) throw new Error("step limit exceeded");
      }, () => { throw reason; })) assert.fail(`unexpected row ${row.line}`);
    }, error => error === reason);
    assert.equal(steps, 1);
    assert.equal(finalized, true);
  }
});

test("CSV first-character failure prevents row admission", async () => {
  let admissions = 0;
  const reason = new Error("step limit exceeded");
  async function* lines() { yield "a,b\n"; }
  await assert.rejects(async () => {
    for await (const row of readCsvStream(lines(), {}, () => { throw reason; }, () => { admissions++; })) assert.fail(`unexpected row ${row.line}`);
  }, error => error === reason);
  assert.equal(admissions, 0);
});

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
