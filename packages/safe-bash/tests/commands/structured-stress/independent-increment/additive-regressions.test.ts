import assert from "node:assert/strict";
import { test } from "node:test";
import { executeVector, expectedBytes } from "./harness.js";
import { additiveVectors } from "./phase2-harness.js";

test("additive pre-fix evidence retains all 81 unique cases", () => {
  assert.equal(additiveVectors.length, 81);
  assert.equal(new Set(additiveVectors.map(vector => vector.id)).size, 81);
});
for (const vector of additiveVectors) test(`additive native exact bytes: ${vector.id}`, async () => {
  assert.deepEqual(await executeVector(vector), expectedBytes(vector));
});
