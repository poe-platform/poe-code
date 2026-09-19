import assert from "node:assert/strict";
import { test } from "vitest";
import { sqlOptions } from "./sql-options.js";
import { CsvkitBlocked } from "./errors.js";

for (const [raw, entries] of [
  ["{'2': 'first', '1': 'second'}", [["2", "first"], ["1", "second"]]],
  ["{'2': 'first', '1': 'second', '2': 'replacement'}", [["2", "replacement"], ["1", "second"]]],
  ["{'4294967294': 'first', '0': 'second'}", [["4294967294", "first"], ["0", "second"]]]
] as const) test(`SQL literal dictionary preserves Python insertion order: ${raw}`, () => {
  const dictionary = sqlOptions([["option", raw]]).option;
  assert.ok(dictionary instanceof Map);
  assert.deepEqual([...dictionary.entries()], entries);
});

for (const key of ["00", "01", "-0", "+1", "1.0", "4294967295", "9007199254740992"]) {
  test(`SQL literal ordinary string key ${key} retains null-prototype record representation`, () => {
    const dictionary = sqlOptions([["option", `{'${key}': 'first', 'ordinary': 'second'}`]]).option;
    assert.equal(Object.getPrototypeOf(dictionary), null);
    assert.deepEqual(Object.entries(dictionary as Record<string, unknown>), [[key, "first"], ["ordinary", "second"]]);
  });
}

test("SQL option top-level contract remains a record for numeric option names", () => {
  const options = sqlOptions([["2", "True"], ["1", "False"]]);
  assert.equal(Object.getPrototypeOf(options), null);
  assert.equal(options["2"], true);
  assert.equal(options["1"], false);
});

for (const raw of [
  "'\\ud800'", "'\\udfff'", "'\\U0000d800'", "{'\\ud83d\\ude00': 1, '\\U0001f600': 2}",
  "{'\\ud83d\\ude00', '\\U0001f600'}", "'\\ud83d' '\\ude00'"
]) test(`SQL surrogate escape scalar identity remains an explicit blocker: ${raw}`, () => {
  assert.throws(() => sqlOptions([["option", raw]]), CsvkitBlocked);
});

for (const [raw, expected] of [["r'\\ud800'", "\\ud800"], ["'\\ud7ff'", "\ud7ff"], ["'\\ue000'", "\ue000"], ["'\\U0001f600'", "😀"]]) {
  test(`SQL scalar identity boundary admits nonsurrogate escape or raw string: ${raw}`, () => {
    assert.equal(sqlOptions([["option", raw]]).option, expected);
  });
}
