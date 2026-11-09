import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { aviAst, parseAvi, parseMkv, serializeAvi } from "./index.js";

// Native FFmpeg: three seconds of 96x64 testsrc2 at 12 fps, libvpx-vp9;
// ffmpeg -i avi-vp9.webm -map 0:v:0 -c copy vp9.avi
const source = parseMkv(new Uint8Array(readFileSync(new URL("./fixtures/avi-vp9.webm", import.meta.url))));
const native = new Uint8Array(readFileSync(new URL("./fixtures/vp9.avi", import.meta.url)));

it("reads native VP90 AVI packets without H.264 conversion or decoding", () => {
  const track = parseAvi(native, { decodeFrames: true }).tracks[0]!;
  assert.equal(track.codecDescriptions[0]!.codecName, "vp9");
  assert.equal(track.codecDescriptions[0]!.formatFourCC, "vp09");
  assert.equal(track.codecDescriptions[0]!.avcC, undefined);
  assert.equal(track.samples.length, 36);
  assert.deepEqual(track.samples.map(sample => sample.data), source.tracks[0]!.samples.map(sample => sample.data));
});

it("writes VP90 AVI headers and every original VP9 packet", () => {
  assert.ok(aviAst().supportedVideoCodecs.includes("vp9"));
  const output = Buffer.from(serializeAvi(source));
  const strh = output.indexOf("strh");
  const strf = output.indexOf("strf");
  assert.equal(output.toString("ascii", strh + 12, strh + 16), "VP90");
  assert.equal(output.toString("ascii", strf + 24, strf + 28), "VP90");
  const actual = parseAvi(new Uint8Array(output)).tracks[0]!;
  assert.equal(actual.codecDescriptions[0]!.codecName, "vp9");
  assert.equal(actual.width, 96);
  assert.equal(actual.height, 64);
  assert.deepEqual(actual.samples.map(sample => sample.data), source.tracks[0]!.samples.map(sample => sample.data));
});
