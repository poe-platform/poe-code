import assert from "node:assert/strict";
import test from "node:test";
import { createSpongeCommand, settings } from "./index.js";

test("sponge command definition exports standard contract", () => {
  const def = createSpongeCommand();
  assert.equal(def.name, "sponge");
  assert.equal(typeof def.execute, "function");
});

test("sponge input quotas are optional with equivalent flat and nested options", () => {
  assert.equal(settings().maxBufferedBytes, Infinity);
  for (const value of [Infinity, 16]) {
    assert.equal(settings({ maxBufferedBytes: value }).maxBufferedBytes, value);
    assert.equal(settings({ limits: { maxBufferedBytes: value } }).maxBufferedBytes, value);
  }
  for (const value of [-Infinity, NaN, -1, 0, 1.5]) assert.throws(() => settings({ maxBufferedBytes: value }), RangeError);
});
