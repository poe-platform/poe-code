import assert from "node:assert/strict";
import { it } from "node:test";
import { parseQpdfPageLabels } from "./page-labels.js";

it("preserves valid page-label defaults, prefixes and omitted styles", () => {
  assert.deepEqual(parseQpdfPageLabels(["1:r/2/前", "7:D//title", "8:/1/zero", "9:A/2", "10:/", "11:D/1/a/b"], 11), [
    { index: 0, style: "r", start: 2, prefix: "前" },
    { index: 6, style: "D", start: 1, prefix: "title" },
    { index: 7, start: 1, prefix: "zero" },
    { index: 8, style: "A", start: 2, prefix: "" },
    { index: 9, start: 1, prefix: "" },
    { index: 10, style: "D", start: 1, prefix: "a/b" },
  ]);
});
