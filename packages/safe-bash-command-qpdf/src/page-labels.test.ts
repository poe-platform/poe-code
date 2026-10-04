import assert from "node:assert/strict";
import { it } from "node:test";
import { parseQpdfPageLabels } from "./page-labels.js";

it("preserves page-label defaults, prefixes, duplicate order and permissive numeric operands", () => {
  assert.deepEqual([...parseQpdfPageLabels(["1:r/2/前", "7:D/title", "0:n/0/zero", "2:A/-2", "1:/", "10000000000000000000:D/1", "bad"])], [
    { index: 0, style: "r", start: 2, prefix: "前" },
    { index: 6, style: "D", start: 1, prefix: "title" },
    { index: 0, start: 1, prefix: "zero" },
    { index: 1, style: "A", start: -2, prefix: "" },
    { index: 0, style: "", start: 1, prefix: "" },
    { index: 10000000000000000000, style: "D", start: 1, prefix: "" },
  ]);
});
