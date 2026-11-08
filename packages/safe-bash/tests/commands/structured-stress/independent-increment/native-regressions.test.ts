import assert from "node:assert/strict";
import { test } from "node:test";
import { allVectors, digest, executeVector, expectedBytes, supplementBytes, supplementHash, vectorBytes, vectorHash } from "./harness.js";

test("independent native vectors retain their frozen exact-byte hashes", () => {
  assert.equal(digest(vectorBytes), vectorHash);
  assert.equal(digest(supplementBytes), supplementHash);
  assert.equal(new Set(allVectors.map(vector => vector.id)).size, allVectors.length);
  for (const vector of allVectors) {
    assert.equal(digest(Buffer.from(vector.inputHex, "hex")), vector.inputSha256, vector.id);
    assert.equal(digest(Buffer.from(vector.expected.stdoutHex, "hex")), vector.expected.stdoutSha256, vector.id);
    assert.equal(digest(Buffer.from(vector.expected.stderrHex, "hex")), vector.expected.stderrSha256, vector.id);
  }
});

for (const vector of allVectors) test(`native exact bytes: ${vector.id}`, { timeout: 2500 }, async () => {
  assert.deepEqual(await executeVector(vector), expectedBytes(vector));
});
