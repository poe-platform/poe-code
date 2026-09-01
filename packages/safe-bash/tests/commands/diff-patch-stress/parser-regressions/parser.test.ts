import assert from "node:assert/strict";
import { test } from "node:test";
import { cases } from "./fixtures.js";
import { product, productIssues } from "./helpers.js";

for (const fixture of cases) {
  test(fixture.id, { timeout: 5000 }, async () => {
    const result = await product(fixture);
    assert.deepEqual(productIssues(fixture, result), [], JSON.stringify({ id: fixture.id, before: fixture.before, patch: fixture.patch, options: fixture.options }));
  });
}
