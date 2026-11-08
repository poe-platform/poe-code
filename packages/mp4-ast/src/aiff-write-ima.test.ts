import assert from "node:assert/strict";
import { it } from "node:test";
import { encodeImaQt } from "./containers/aiff-ima-encoder.js";
import { MediaBudgetTracker } from "./types.js";

it("matches native FFmpeg across stereo packet boundaries and zero padding", () => {
  const channels = Array.from({ length: 2 }, (_, ch) => Float32Array.from({ length: 137 },
    (_, i) => ((i * (ch + 3) * 997) % 60000 - 30000) / 32768));
  const native = "0000ffffffff383424243343f3ff0800001000111021f1af0000011010111111f2bf0000ffffff1f67232433ff0d1000011111f10f000010100111ef000010101010f10eb5530000010111112121f3df0000001000111111f2bf1000000111111122f1cf0000b7d7000001011110ef000001101010f10e001000010111ef000010101001f10e0010d95100011110f1888080808080808008088008808008088080080880800808800880fcd3000101119f080808088800888000880008888000088800888000088880000888";
  assert.equal(Buffer.from(encodeImaQt(channels)).toString("hex"), native);
});

it("bounds encoded allocations and rejects unsupported channel layouts", () => {
  assert.throws(() => encodeImaQt([new Float32Array(1)], new MediaBudgetTracker({ maxMemoryBytes: 1 })), /memory/i);
  assert.throws(() => encodeImaQt([new Float32Array(1)], new MediaBudgetTracker({ maxOutputBytes: 1 })), /output/i);
  assert.throws(() => encodeImaQt(Array.from({ length: 3 }, () => new Float32Array(1))), /mono or stereo/);
  assert.throws(() => encodeImaQt([new Float32Array(1), new Float32Array(2)]), /Unequal/);
});
