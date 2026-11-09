import assert from "node:assert/strict";
import { it } from "node:test";
import { encodeH264Preset } from "./x264-encoder.js";

it("validates bitrate before entering the H.264 encoder", () => {
  for (const bitrate of [-1, 1.5, NaN, Infinity, 2147483648]) {
    assert.throws(() => [...encodeH264Preset([], 16, 16, 12, 1, "medium", -1, -1, bitrate)], /Invalid H.264 bitrate/);
  }
});
