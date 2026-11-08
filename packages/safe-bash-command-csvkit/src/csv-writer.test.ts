import assert from "node:assert/strict";
import { test } from "vitest";
import { Writer, DictionaryWriter, writeCsvRow } from "./csv.js";

const bytes = (text: string) => new TextEncoder().encode(text);
const equal = (actual: string, expected: string) => assert.deepEqual(bytes(actual), bytes(expected));

test("typed Agate writer retains Python representations and numeric quoting categories", () => {
  equal(writeCsvRow([true, false, null, { kind: "decimal", value: "1.2300" },
    { kind: "date", value: "2026-09-18" }, { kind: "datetime", value: "2026-09-18 01:02:03.000004+00:00" },
    { kind: "timedelta", microseconds: -1n }], { quoting: 2 }),
    'True,False,"",1.2300,"2026-09-18","2026-09-18 01:02:03.000004+00:00","-1 day, 23:59:59.999999"\n');
  equal(writeCsvRow([true, 1, "1", null], { quoting: 4 }), 'True,1,"1",\n');
  equal(writeCsvRow([true, 1, "1", null], { quoting: 5 }), '"True","1","1",\n');
});

test("newer quote modes distinguish a single null from a single empty string", () => {
  for (const quoting of [4, 5]) {
    assert.throws(() => writeCsvRow([null], { quoting }), /single empty field record must be quoted/);
    equal(writeCsvRow([""], { quoting }), '""\n');
    equal(writeCsvRow([], { quoting }), '\n');
  }
});

test("writer snapshots dialect and counts emitted records including blanks", () => {
  const dialect = { delimiter: ";" };
  const writer = new Writer({ ...dialect, lineNumbers: true });
  dialect.delimiter = "|";
  equal(writer.writerow(["a", "b"]), 'line_number;a;b\n');
  equal(writer.writerow([]), '1\n');
  equal(writer.writerow(["x\r\ny"]), '2;"x\n\ny"\n');
  equal(new Writer().writerow(["a", "b"]), 'a,b\n');
});

test("dictionary writer handles duplicate headers, missing keys, extras and numbered headers", () => {
  const fields = ["a", "a", "b"];
  const writer = new DictionaryWriter(fields, { restval: "missing", lineNumbers: true });
  equal(writer.writeheader(), 'line_number,a,a,b\n');
  equal(writer.writerow({ a: "x\ry" }), '1,"x\ny","x\ny",missing\n');
  assert.deepEqual(fields, ["a", "a", "b"]);
  assert.throws(() => writer.writerow({ a: 1, extra: 2 }), /dict contains fields not in fieldnames: 'extra'/);
  equal(writer.writerow({ b: null }), '3,missing,missing,\n');
  equal(new DictionaryWriter(["a"], { extrasaction: "IGNORE" }).writerow({ a: "ok", extra: 1 }), 'ok\n');
  assert.throws(() => new DictionaryWriter([], { extrasaction: "invalid" }), /extrasaction/);
  equal(new DictionaryWriter(["toString"]).writerow({}), '""\n');
});
