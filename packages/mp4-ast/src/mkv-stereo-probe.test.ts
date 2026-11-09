import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { parseMkv, probeMkv } from "./containers/mkv.js";

// Native ffprobe 7.0.2 results, changing only the one-byte StereoMode element.
const fixture = readFileSync(new URL("./fixtures/stereo-left_right.mkv", import.meta.url));
const offset = fixture.indexOf(new Uint8Array([0x53, 0xb8, 0x81, 1])) + 3;
assert.ok(offset >= 3);
const cases: readonly [number, string | undefined, string | undefined, number][] = [
  [0, undefined, "2D", 0],
  [1, "left_right", "side by side", 0],
  [2, "bottom_top", "top and bottom", 1],
  [3, "top_bottom", "top and bottom", 0],
  [4, "checkerboard_rl", "checkerboard", 1],
  [5, "checkerboard_lr", "checkerboard", 0],
  [6, "row_interleaved_rl", "interleaved lines", 1],
  [7, "row_interleaved_lr", "interleaved lines", 0],
  [8, "col_interleaved_rl", "interleaved columns", 1],
  [9, "col_interleaved_lr", "interleaved columns", 0],
  [10, "anaglyph_cyan_red", undefined, 0],
  [11, "right_left", "side by side", 1],
  [12, "anaglyph_green_magenta", undefined, 0],
  [13, "block_lr", "frame alternate", 0],
  [14, "block_rl", "frame alternate", 1],
  [15, undefined, undefined, 0],
  [255, undefined, undefined, 0]
];

for (const [mode, tag, type, inverted] of cases) {
  it(`probes native Matroska StereoMode ${mode}`, () => {
    const bytes = new Uint8Array(fixture);
    bytes[offset] = mode;
    assert.equal(parseMkv(bytes).tracks[0]!.codecDescriptions[0]!.stereoMode, mode);
    const stream = probeMkv(bytes).streams[0]!;
    assert.equal(stream.tags?.stereo_mode, tag);
    assert.deepEqual(stream.side_data_list, type ? [{ side_data_type: "Stereo 3D", type, inverted }] : undefined);
  });
}

it("probes native WebM stereo metadata without remuxing", () => {
  const bytes = readFileSync(new URL("./fixtures/vp9-stereo.webm", import.meta.url));
  const stream = probeMkv(bytes).streams[0]!;
  assert.equal(stream.tags?.stereo_mode, "left_right");
  assert.deepEqual(stream.side_data_list, [{ side_data_type: "Stereo 3D", type: "side by side", inverted: 0 }]);
});
