import { test, expect } from "vitest";
import { compilePythonSearch } from "./python-regex.js";
import { CsvkitBlocked } from "./errors.js";

test("Python set difference warnings after class ranges remain explicit blockers", () => {
  for (const pattern of ["[a-b--c]", "[a-b--]", "[^a-b--c]"]) {
    expect(() => compilePythonSearch(pattern, () => {}, 100_000, () => {})).toThrow(CsvkitBlocked);
  }
});

test("a leading double hyphen class range has no Python set difference warning", () => {
  const search = compilePythonSearch("[--a]", () => {}, 100_000, () => {});
  expect(["-", "a", "b", "😀"].map(search)).toEqual([true, true, false, false]);
});
