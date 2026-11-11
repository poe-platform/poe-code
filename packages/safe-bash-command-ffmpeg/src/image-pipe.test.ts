import assert from "node:assert/strict";
import { it } from "node:test";
import { MediaBudgetTracker } from "@poe-code/mp4-ast";
import { imagePipeFrameEnd } from "./image-pipe.js";

for (const packet of [
  Buffer.concat([Buffer.from("P6\n# dimensions\n2 1\n255\n"), Buffer.from("P6\n #\n")]),
  Buffer.concat([Buffer.from("P5\n2 1\n65535\n"), Buffer.from([0, 10, 80, 53])]),
  Buffer.from("P3\n2 1\n255\n255 0 # pixel\n0 0 0 255\n"),
  Buffer.from("P2\n2 1\n65535\n65535 0\n")
]) {
  it(`frames ${packet.subarray(0, 2)} by sample count including comments and 16-bit rasters`, () => {
    const codec = packet[1] === 51 || packet[1] === 54 ? "ppm" : "pgm";
    const bytes = Buffer.concat([packet, packet]);
    assert.equal(imagePipeFrameEnd(bytes, 0, codec, new MediaBudgetTracker()), packet.length);
    assert.equal(imagePipeFrameEnd(bytes, packet.length, codec, new MediaBudgetTracker()), bytes.length);
  });
}

it("skips JPEG metadata and stuffed/restart markers before the true end of image", () => {
  const packet = Uint8Array.from([
    255, 216, 255, 254, 0, 6, 255, 217, 255, 216, // COM containing EOI and SOI
    255, 218, 0, 2, 42, 255, 0, 217, 255, 208, 42, 255, 217
  ]);
  assert.equal(imagePipeFrameEnd(Buffer.concat([packet, packet]), 0, "mjpeg", new MediaBudgetTracker()), packet.length);
});

it("counts QOI opcodes before reading an end marker even when pixels contain zeroes", () => {
  const packet = Uint8Array.from([
    113, 111, 105, 102, 0, 0, 0, 3, 0, 0, 0, 1, 4, 0,
    255, 0, 0, 0, 0, 0, 0, // RGBA and two index pixels
    0, 0, 0, 0, 0, 0, 0, 1
  ]);
  assert.equal(imagePipeFrameEnd(Buffer.concat([packet, packet]), 0, "qoi", new MediaBudgetTracker()), packet.length);
});

for (const [codec, bytes] of [
  ["bmp", [66, 77, 255, 255, 255, 255, 0, 0, 0, 0, 0, 0, 0, 0]],
  ["mjpeg", [255, 216, 255, 254, 0, 1]],
  ["qoi", [113, 111, 105, 102, 0, 0, 0, 1, 0, 0, 0, 1, 3, 0, 193, 0, 0, 0, 0, 0, 0, 0, 1]],
  ["ppm", [...Buffer.from("P6\n9007199254740992 2\n255\n")]],
  ["pgm", [...Buffer.from("P5\n1 1\n0\n\0")]]
] as const) {
  it(`rejects invalid ${codec} frame lengths`, () => {
    assert.throws(() => imagePipeFrameEnd(Uint8Array.from(bytes), 0, codec, new MediaBudgetTracker()), /image2pipe/);
  });
}
