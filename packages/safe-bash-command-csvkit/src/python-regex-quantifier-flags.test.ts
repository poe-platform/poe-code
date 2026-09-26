import assert from "node:assert/strict";
import { test } from "vitest";
import reference from "../../../docs/csvkit/python-regex-reference.json" with { type: "json" };
import { compilePythonSearch } from "./python-regex.js";
import { CsvkitBlocked } from "./errors.js";

for (const item of reference.cases.filter(item => ["consecutive-global-flags", "omitted-minimum"].includes(item.category))) {
  test(`Python original regression: ${item.category}`, () => {
    const search = compilePythonSearch(item.pattern, () => {}, 100_000, () => {});
    assert.deepEqual(item.texts.map(search), item.reference.matches);
  });
}

test("omitted minimum quantifiers preserve anchors, lazy membership and empty progress", () => {
  for (const pattern of ["^a{,2}$", "^a{,2}?$", "^(?:a?){,2}$"]) {
    const search = compilePythonSearch(pattern, () => {}, 100_000, () => {});
    assert.deepEqual(["", "a", "aa", "aaa"].map(search), [true, true, true, false]);
  }
});

test("consecutive flags accumulate while conflicting flags and misplaced flags remain blockers", () => {
  const search = compilePythonSearch("(?a)(?i)(?m)^a$", () => {}, 100_000, () => {});
  assert.equal(search("b\nA\nc"), true);
  for (const pattern of ["(?a)(?u)a", "(?u)(?a)a", "a(?i)", "(?i:a)", "a{,4294967295}", "a{,2}+"]) {
    assert.throws(() => compilePythonSearch(pattern, () => {}, 100_000, () => {}), CsvkitBlocked);
  }
});
