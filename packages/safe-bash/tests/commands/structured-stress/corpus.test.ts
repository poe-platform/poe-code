import assert from "node:assert/strict";
import { test } from "node:test";
import { independentCases } from "./cases.js";
import { corpus } from "./corpus.js";
import { check } from "./harness.js";

test("frozen native corpus retains every independently generated case", () => {
  assert.deepEqual(corpus.fixtures.map(({ id, input, argv }) => ({ id, input, argv })), independentCases());
  assert.equal(new Set(corpus.fixtures.map(fixture => fixture.id)).size, corpus.fixtures.length);
  assert.equal(corpus.provenance.native, "jq-1.7.1-apple");
  assert.equal(corpus.provenance.seed, "0x93ade117");
});

for (const fixture of corpus.fixtures) test(`independent corpus: ${fixture.id}`, { timeout: 3000 }, () => check(fixture));
