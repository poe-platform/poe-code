import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { nutAst } from "./containers/nut.js";

// Native FFmpeg fixtures: sine=frequency=523:sample_rate=8000:duration=0.25
// encoded as pcm_s16le, pcm_s64le and pcm_s64be. RGB input is 72 bytes
// (i * 7 + 11) % 256, rawvideo/rgb24, 3x2 at 5 fps, copied into NUT.
const rgb = readFileSync(new URL("./fixtures/rgb.nut", import.meta.url));
const tone = readFileSync(new URL("./fixtures/tone.nut", import.meta.url));
const ast = nutAst();

it("retains native NUT packet bytes, positions and time bases", () => {
  const doc = ast.parse(rgb);
  const track = doc.tracks[0]!;
  assert.equal(track.timescale, 81920);
  assert.deepEqual(track.samples.map(sample => sample.pts), [0, 16384, 32768, 49152]);
  assert.deepEqual(track.samples.map(sample => sample.duration), [16384, 16384, 16384, 16384]);
  assert.deepEqual(track.samples.flatMap(sample => [...sample.data]), Array.from({ length: 72 }, (_, i) => (i * 7 + 11) % 256));
  for (const sample of track.samples) assert.deepEqual(sample.data, rgb.subarray(sample.offset!, sample.offset! + sample.size));
  const probe = ast.probe(rgb, { showPackets: true });
  assert.equal(probe.streams[0]!.avg_frame_rate, "5/1");
  assert.equal(probe.format.format_name, "nut");
});

it("skips audio decoding for probing and preserves PCM packet boundaries", () => {
  const track = ast.parse(tone, { decodeAudio: false }).tracks[0]!;
  assert.equal(track.decodedAudio, undefined);
  assert.equal(track.duration, 2000);
  assert.equal(track.codecDescriptions[0]!.codecName, "pcm_s16le");
  assert.equal(track.samples.reduce((sum, sample) => sum + sample.size, 0), 4000);
  assert.equal(ast.parse(tone).tracks[0]!.decodedAudio!.channelData[0]!.length, 2000);
});

it("rejects truncation, damaged headers and oversized input within resource limits", () => {
  for (const length of [0, 23, 32, 100, 125, 260, rgb.length - 1]) {
    assert.throws(() => ast.parse(rgb.subarray(0, length)), /NUT/);
  }
  const damaged = Buffer.from(rgb);
  damaged[40] = damaged[40]! ^ 1;
  assert.throws(() => ast.parse(damaged), /checksum/);
  assert.throws(() => ast.parse(rgb, { limits: { maxInputBytes: 40 } }), /limit/i);
  assert.throws(() => ast.parse(rgb, { limits: { maxSamplesPerTrack: 2 } }), /limit/i);
  assert.throws(() => ast.parse(rgb, { limits: { maxDurationSeconds: 0.1 } }), /limit/i);
  assert.throws(() => ast.parse(tone, { limits: { maxMemoryBytes: 1 } }), /limit/i);
});
