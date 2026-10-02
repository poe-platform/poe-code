import assert from "node:assert/strict";
import test from "node:test";
import { createSpongeCommand, evalSyncSponge, settings } from "./index.js";

test("sponge command definition exports standard contract", () => {
  const def = createSpongeCommand();
  assert.equal(def.name, "sponge");
  assert.equal(typeof def.execute, "function");
});

test("sponge input quotas are optional with equivalent flat and nested options", () => {
  assert.equal(settings().maxBufferedBytes, Infinity);
  assert.equal(settings({ limits: { ["maxBufferedBytes" as string]: undefined } }).maxBufferedBytes, Infinity);
  for (const value of [Infinity, 16]) {
    assert.equal(settings({ maxBufferedBytes: value }).maxBufferedBytes, value);
    assert.equal(settings({ limits: { maxBufferedBytes: value } }).maxBufferedBytes, value);
  }
  for (const value of [-Infinity, NaN, -1, 0, 1.5]) assert.throws(() => settings({ maxBufferedBytes: value }), RangeError);
});

test("sponge owns synchronous byte writes and declines append and binary text decoding", () => {
  const bytes = new Uint8Array([0, 255, 10]);
  let output: Uint8Array | undefined;
  assert.equal(evalSyncSponge(bytes, ["out"], undefined, (path, value) => {
    assert.equal(path, "out");
    output = value.slice();
    return true;
  }), "");
  assert.deepEqual(output, bytes);
  assert.equal(evalSyncSponge(bytes, []), undefined);
  assert.equal(evalSyncSponge(bytes, ["-a", "out"]), undefined);
});
