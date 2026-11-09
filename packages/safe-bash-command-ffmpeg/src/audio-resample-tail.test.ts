import assert from "node:assert/strict";
import { it } from "node:test";
import { MediaBudgetTracker } from "@poe-code/mp4-ast";
import { resampleAudio } from "./audio-resample.js";

// FFmpeg 7.0.2: 128 PCM16 samples of a 250 Hz tone at amplitude 12000,
// resampled with default swresample settings and emitted as f32le.
for (const [from, to, tail] of [
  [8000, 16000, [-0.258941650390625, -0.2316751778125763, -0.203460693359375,
    -0.17387011647224426, -0.14013671875, -0.10296376049518585, -0.071441650390625, -0.05880757421255112]],
  [16000, 8000, [-0.366412878036499, -0.3588612675666809, -0.33878451585769653,
    -0.3038669228553772, -0.25985077023506165, -0.20214131474494934, -0.14226579666137695, -0.06708800792694092]]
] as const) {
  it(`resamples the flushed tail from ${from} to ${to} Hz like native FFmpeg`, async () => {
    const input = Float64Array.from({ length: 128 }, (_, i) =>
      Math.round(12000 * Math.sin(2 * Math.PI * 250 * i / from)) / 32768);
    const [output] = await resampleAudio([input], input.length * to / from, from, to, new MediaBudgetTracker());
    assert.equal(output!.length, input.length * to / from);
    for (const [i, expected] of tail.entries()) {
      const actual = output![output!.length - tail.length + i]!;
      assert.ok(Math.abs(actual - expected) <= 1e-7, `tail sample ${i}: ${actual}, expected ${expected}`);
    }
  });
}
