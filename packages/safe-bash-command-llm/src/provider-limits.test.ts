import assert from "node:assert/strict";
import test from "node:test";
import { providerLimits } from "./providers/shared.js";

test("provider quotas accept undefined and Infinity while retaining finite limits", () => {
  const defaults = providerLimits();
  for (const key of ["maxRequestBytes", "maxResponseBytes", "maxEventBytes", "maxPolls"] as const) {
    assert.equal(defaults[key], Infinity);
    for (const value of [undefined, Infinity]) assert.deepEqual(providerLimits({ [key]: value }), defaults);
    assert.equal(providerLimits({ [key]: 3 })[key], 3);
    for (const value of [-Infinity, NaN, -1, 0.5]) assert.throws(() => providerLimits({ [key]: value }), RangeError);
  }
  assert.deepEqual(providerLimits({ ["pollIntervalMs" as string]: undefined }), defaults);
  assert.throws(() => providerLimits({ pollIntervalMs: Infinity }), RangeError);
});
