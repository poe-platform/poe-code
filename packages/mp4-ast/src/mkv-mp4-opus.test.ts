import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { parseDOps } from "./codecs.js";
import { parseMkv, serializeMkv } from "./containers/mkv.js";
import { parseMp4 } from "./mp4.js";

// ffmpeg -i tone-opus.ogg -c copy tone-opus.mp4; 48 kHz mono, 312 pre-skip samples.
const input = new Uint8Array(readFileSync(new URL("./fixtures/tone-opus.mp4", import.meta.url)));

for (const webm of [false, true]) {
  it(`translates MP4 Opus configuration and presentation time into ${webm ? "WebM" : "Matroska"}`, () => {
    const source = parseMp4(input, { decodeAudio: false });
    const before = structuredClone(source);
    const copied = parseMkv(serializeMkv(source, { webm }));
    const track = copied.tracks[0]!;
    assert.deepEqual(track.codecDescriptions[0]!.extraData, new Uint8Array([
      79, 112, 117, 115, 72, 101, 97, 100, 1, 1, 56, 1, 128, 187, 0, 0, 0, 0, 0
    ]));
    assert.equal(track.codecDelayNs, 6_500_000);
    assert.equal(track.seekPreRollNs, 80_000_000);
    assert.deepEqual(track.samples.slice(0, 5).map(sample => sample.pts), [-7, 14, 34, 54, 74]);
    assert.equal(track.samples.length, 38);
    assert.deepEqual(track.samples.map(sample => sample.data), source.tracks[0]!.samples.map(sample => sample.data));
    assert.deepEqual(source, before);
    const repeated = parseMkv(serializeMkv(copied, { webm })).tracks[0]!;
    assert.deepEqual(repeated.codecDescriptions[0]!.extraData, track.codecDescriptions[0]!.extraData);
    assert.equal(repeated.codecDelayNs, track.codecDelayNs);
    assert.deepEqual(repeated.samples.map(sample => sample.pts), track.samples.map(sample => sample.pts));
  });
}

it("preserves mapped Opus channels, signed gain, input rate and zero pre-skip", () => {
  const source = parseMp4(input, { decodeAudio: false });
  const track = source.tracks[0]!;
  const dOps = parseDOps(new Uint8Array([
    0, 6, 0, 0, 0, 0, 172, 68, 255, 0, 1, 4, 2, 0, 4, 1, 2, 3, 5
  ]));
  const copied = parseMkv(serializeMkv({ ...source, tracks: [{ ...track,
    editList: undefined, codecDescriptions: [{ ...track.codecDescriptions[0]!, channels: 6, dOps }]
  }] })).tracks[0]!;
  assert.deepEqual(copied.codecDescriptions[0]!.extraData, new Uint8Array([
    79, 112, 117, 115, 72, 101, 97, 100, 1, 6, 0, 0, 68, 172, 0, 0, 0, 255, 1, 4, 2, 0, 4, 1, 2, 3, 5
  ]));
  assert.equal(copied.codecDelayNs, 0);
  assert.equal(copied.samples[0]!.pts, 0);
});
