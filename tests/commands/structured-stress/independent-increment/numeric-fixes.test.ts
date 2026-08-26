import assert from "node:assert/strict";
import { test } from "node:test";
import { allVectors, bytesSource, executeBytes, executeVector, expectedBytes } from "./harness.js";
import { additiveVectors, authorProbeMistakes } from "./phase2-harness.js";

const numericVectors = [
  ...allVectors.filter(vector => vector.category.startsWith("numeric") && vector.id !== "fromjson"),
  ...additiveVectors.filter(vector => vector.category !== "quantifier-generator" && !authorProbeMistakes.has(vector.id)),
];
test("focused numeric scope excludes only the explicitly diagnosed probe mistakes", () => {
  assert.equal(numericVectors.length, 124);
});
for (const vector of numericVectors) test(`numeric native bytes: ${vector.id}`, async () => {
  assert.deepEqual(await executeVector(vector), expectedBytes(vector));
});
for (const id of ["number-large-integer-identity", "number-long-fraction-conversion", "copy-nested", "decimal-1.2300e-7"]) {
  test(`numeric token every input split: ${id}`, async () => {
    const vector = numericVectors.find(item => item.id === id)!;
    const bytes = Buffer.from(vector.inputHex, "hex");
    for (let split = 0; split <= bytes.length; split++) {
      const source = (async function* () { yield bytes.subarray(0, split); yield bytes.subarray(split); })();
      assert.deepEqual(await executeBytes(vector.argv!, source), expectedBytes(vector), `split ${split}`);
    }
    assert.deepEqual(await executeBytes(vector.argv!, bytesSource(bytes, 1)), expectedBytes(vector));
  });
}
