import assert from "node:assert/strict";
import { test } from "vitest";
import { DictionaryWriter, Writer, writeCsvRow } from "./csv.js";

const bytes = (text: string) => new TextEncoder().encode(text);

test("dictionary missing-key defaults retain null in newer quoting modes", () => {
  for (const quoting of [4, 5]) {
    const writer = new DictionaryWriter(["a", "b"], { restval: null, quoting });
    assert.deepEqual(bytes(writer.writerow({ a: "" })), bytes('"",\n'));
  }
});

test("dictionary CR normalization applies to supplied values before missing-key substitution", () => {
  const writer = new DictionaryWriter(["a", "b"], { restval: "missing\rvalue" });
  assert.deepEqual(bytes(writer.writerow({ a: "supplied\rvalue" })), bytes('"supplied\nvalue","missing\rvalue"\n'));
});

test("writer escape and doubled-quote combinations preserve exact bytes", () => {
  assert.deepEqual(bytes(writeCsvRow(['a"b', "c\\d", "e,f", "g\rh"], { escapechar: "\\" })),
    bytes('"a""b",c\\\\d,"e,f","g\nh"\n'));
  assert.deepEqual(bytes(writeCsvRow(['a"b', "c\\d", "e,f", "g\rh"], { escapechar: "\\", doublequote: false })),
    bytes('a\\"b,c\\\\d,"e,f","g\nh"\n'));
  assert.deepEqual(bytes(writeCsvRow(['a"b', "c\\d", "e,f", "g\rh"], { escapechar: "\\", quoting: 3 })),
    bytes('a\\"b,c\\\\d,e\\,f,g\\\nh\n'));
});

test("writer snapshots caller dialect and isolates numbering across instances", () => {
  const dialect = { delimiter: ";", lineNumbers: true };
  const writer = new Writer(dialect);
  dialect.delimiter = "|";
  dialect.lineNumbers = false;
  assert.deepEqual(bytes(writer.writerow(["a"])), bytes("line_number;a\n"));
  assert.deepEqual(bytes(writer.writerow(["x\ny"])), bytes('1;"x\ny"\n'));
  const independent = new Writer({ lineNumbers: true });
  assert.deepEqual(bytes(independent.writerow(["a"])), bytes("line_number,a\n"));
  assert.deepEqual(bytes(independent.writerow(["b"])), bytes("1,b\n"));
});

test("dictionary duplicate special-name headers read only own keys", () => {
  const writer = new DictionaryWriter(["__proto__", "constructor", "__proto__"], { restval: "missing" });
  assert.deepEqual(bytes(writer.writeheader()), bytes("__proto__,constructor,__proto__\n"));
  assert.deepEqual(bytes(writer.writerow(Object.fromEntries([["__proto__", "value"]]))), bytes("value,missing,value\n"));
});

test("timedelta serialization preserves exact day boundaries and microseconds", () => {
  const cases: readonly (readonly [bigint, string])[] = [
    [0n, "0:00:00"], [1n, "0:00:00.000001"],
    [-86400000000n, "-1 day, 0:00:00"],
    [-86400000001n, "-2 days, 23:59:59.999999"],
    [86399999999999999999n, "999999999 days, 23:59:59.999999"],
    [-86399999913600000000n, "-999999999 days, 0:00:00"]
  ];
  for (const [microseconds, expected] of cases) {
    assert.deepEqual(bytes(writeCsvRow([{ kind: "timedelta", microseconds }], { quoting: 2 })),
      bytes(`"${expected}"\n`));
  }
  for (const microseconds of [86400000000000000000n, -86399999913600000001n]) {
    assert.throws(() => writeCsvRow([{ kind: "timedelta", microseconds }]),
      error => error instanceof Error && error.message === "OverflowError: timedelta days out of range");
  }
});

test("writer row iteration is lazy and closes a borrowed iterable on consumer return", () => {
  let produced = 0;
  let closed = false;
  function* source() {
    try {
      produced++; yield ["header"];
      produced++; yield ["value"];
    } finally { closed = true; }
  }
  const rows = new Writer({ lineNumbers: true }).writerows(source());
  assert.equal(produced, 0);
  assert.deepEqual(bytes(rows.next().value!), bytes("line_number,header\n"));
  assert.equal(produced, 1);
  rows.return(undefined);
  assert.equal(closed, true);
  assert.equal(produced, 1);
});

test("writer quotes terminator characters and supports Unicode dialect characters", () => {
  assert.deepEqual(bytes(writeCsvRow(["a;b", "c"], { lineterminator: ";\r\n" })),
    bytes('"a;b",c;\r\n'));
  assert.deepEqual(bytes(writeCsvRow(["a💠b", "c💬d", "e"], { delimiter: "💠", quotechar: "💬" })),
    bytes("💬a💠b💬💠💬c💬💬d💬💠e\n"));
  assert.deepEqual(bytes(writeCsvRow([], { lineterminator: "" })), bytes(""));
});
