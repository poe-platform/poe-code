import { test } from "vitest";
import assert from "node:assert/strict";
import reference from "../../../docs/csvkit/python-regex-reference.json" with { type: "json" };
import { compilePythonSearch } from "./python-regex.js";
import { CsvkitBlocked } from "./errors.js";

for (const [index, item] of reference.cases.entries()) {
  test(`Python frozen re observation ${index}: ${item.category}`, () => {
    const run = () => {
      const search = compilePythonSearch(item.pattern, () => {}, 100_000, () => {});
      return item.texts.map(search);
    };
    if (item.disposition === "supported") {
      assert.deepEqual(item.warnings, []);
      assert.deepEqual(run(), item.reference.matches);
    } else {
      // This verifies refusal only. Native errors/warnings or supported Python
      // features recorded in a blocked case are never credited as parity.
      assert.throws(run, CsvkitBlocked);
    }
  });
}
