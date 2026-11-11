import assert from "node:assert/strict";
import { it } from "node:test";
import { resampleMultiplyAdd } from "./audio-resample-fma.js";

it("rounds once when the product residual breaks an addition tie", () => {
  assert.equal(resampleMultiplyAdd((1 + 2 ** -52) * 2 ** -53, 1 - 2 ** -52, 1 + 2 ** -52), 1 + 2 ** -52);
});

it("retains subnormal results and finite cancellation of overflowing products", () => {
  assert.equal(resampleMultiplyAdd(2 ** -600, 2 ** -475, Number.MIN_VALUE), 2 * Number.MIN_VALUE);
  assert.equal(resampleMultiplyAdd(Number.MAX_VALUE, 2, -Number.MAX_VALUE), Number.MAX_VALUE);
  assert.equal(resampleMultiplyAdd(1e300, 1e-300, -1), 7.756385209041318e-17);
});

it("preserves zero and nonfinite arithmetic", () => {
  assert.equal(resampleMultiplyAdd(-Number.MIN_VALUE, 0.5, 0), -0);
  assert.equal(resampleMultiplyAdd(1, 1, -1), 0);
  assert.equal(resampleMultiplyAdd(Infinity, 1, 1), Infinity);
  assert.ok(Number.isNaN(resampleMultiplyAdd(Infinity, 0, 1)));
});
