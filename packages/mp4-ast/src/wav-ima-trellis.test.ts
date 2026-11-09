import assert from "node:assert/strict";
import { it } from "node:test";
import { encodeImaWav } from "./containers/wav-ima.js";
import { MediaBudgetTracker } from "./types.js";

it("matches native FFmpeg's small-signal IMA WAV trellis bytes", () => {
  const samples = Float32Array.from({ length: 9 }, (_, i) => (i % 13 - 6) / 32768);
  for (const trellis of [0, 1, 2]) {
    const data = encodeImaWav([samples], 1024, trellis);
    assert.equal(Buffer.from(data.subarray(0, 16)).toString("hex"), trellis === 0
      ? "faff0000101010100900000000000000" : "faff0000181818188988888888888888");
    assert.equal(data.length, 1024);
  }
  assert.deepEqual(encodeImaWav([samples], 1024), encodeImaWav([samples], 1024, 0));
});

it("validates SDK trellis depth and accounts for search memory and CPU", () => {
  for (const depth of [-1, 17, 1.5, NaN]) {
    assert.throws(() => encodeImaWav([new Float32Array(9)], 1024, depth), /trellis/);
  }
  assert.throws(() => encodeImaWav([new Float32Array(9)], 1024, 16,
    new MediaBudgetTracker({ maxMemoryBytes: 1024 })), /memory/i);
  const budget = new MediaBudgetTracker();
  let checks = 0;
  budget.checkCpu = () => { checks++; };
  encodeImaWav([new Float32Array(9)], 1024, 1, budget);
  assert.equal(checks, 2040);
});
