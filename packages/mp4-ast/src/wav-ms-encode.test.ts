import assert from "node:assert/strict";
import { it } from "node:test";
import { encodeMsWav } from "./containers/wav-ms.js";
import { MediaBudgetTracker } from "./types.js";

it("bounds MS ADPCM output allocations and rejects incompatible channel data", () => {
  const samples = [new Float32Array(160)];
  assert.throws(() => encodeMsWav(samples, 1024, new MediaBudgetTracker({ maxMemoryBytes: 1023 })), /memory/i);
  assert.throws(() => encodeMsWav(samples, 1024, new MediaBudgetTracker({ maxOutputBytes: 1023 })), /output/i);
  assert.throws(() => encodeMsWav(Array.from({ length: 3 }, () => new Float32Array(1)), 1024), /mono or stereo/);
  assert.throws(() => encodeMsWav([new Float32Array(1), new Float32Array(2)], 1024), /Unequal/);
  assert.deepEqual(encodeMsWav([new Float32Array(0)], 1024), new Uint8Array(0));
});
