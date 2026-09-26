import { test, expect } from "vitest";
import { match, defaultHeaders, parseColumnIdentifiers } from "./columns.js";

test("source helper matches exact non-digit headers before integer conversion", () => {
  for (const name of ["-1", "+1", " 1 ", "1_0", "\"1\"", ""]) {
    expect(match(["first", name, name], name, 1)).toBe(1);
  }
  expect(match(["2", "first"], "2", 1)).toBe(1);
  expect(() => match(["²"], "²", 1)).toThrow("neither an integer nor a column name");
  expect(match(["١", "second"], "١", 1)).toBe(0);
  expect(match(["Ⅳ", "second"], "Ⅳ", 1)).toBe(0);
  expect(() => match(["a", "b"], "\"1\"", 1)).toThrow("neither an integer nor a column name");
});

test("pinned command offsets preserve join and geometry source quirks", () => {
  expect(match(["a", "b"], "1")).toBe(0); // csvjoin omits offset even with --zero
  expect(match(["a", "b"], "1", Number(false))).toBe(1); // csvjson geometry
  expect(match(["a", "b"], "1", Number(true))).toBe(0);
});

test("range expansion uses integers rather than literal signed headers", () => {
  expect(() => parseColumnIdentifiers("-1:1", ["-1", "b"], 1)).toThrow("Column -1 is invalid");
});

test("include and exclusion open endpoints retain different offsets", () => {
  const names = ["a", "b", "c", "d"];
  expect(parseColumnIdentifiers("4,2,2,1:2", names)).toEqual([3, 1, 1, 0, 1]);
  expect(parseColumnIdentifiers("2-", names)).toEqual([1, 2, 3]);
  expect(parseColumnIdentifiers(null, names, 1, "2-,unknown")).toEqual([0, 3]);
  expect(parseColumnIdentifiers("-2", names, 0)).toEqual([1, 2]);
  expect(parseColumnIdentifiers(null, names, 0, "2-")).toEqual([0, 1]);
  expect(() => parseColumnIdentifiers("2-", names, 0)).toThrow("Column 4 is invalid");
  expect(parseColumnIdentifiers("3:1", names)).toEqual([]);
  expect(parseColumnIdentifiers("1-2", ["a", "1-2"])).toEqual([1]);
  expect(() => parseColumnIdentifiers(null, names, 1, "a:b")).toThrow("Invalid range %s");
  expect(parseColumnIdentifiers("anything", [])).toEqual([]);
});

test("source default headers carry across alphabet boundaries", () => {
  const names = defaultHeaders(703);
  expect([names[0], names[25], names[26], names[51], names[52], names[701], names[702]])
    .toEqual(["a", "z", "aa", "az", "ba", "zz", "aaa"]);
});
