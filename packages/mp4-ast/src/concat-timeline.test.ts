import assert from "node:assert/strict";
import { it } from "node:test";
import { encodeWav } from "@poe-code/audio-ast";
import { concatMp4, createSyntheticMp4, parseMp4, parseWav, serializeMp4 } from "./index.js";

for (const start of [0.25, 2]) {
  it(`concat places the next segment at ${start}s without losing decoded PCM`, () => {
    const docs = [1000, -9000].map(base => parseWav(encodeWav({
      sampleRate: 8000,
      channels: [Float64Array.from({ length: 8000 }, (_, i) => (base + i) / 32768)]
    })));
    const options = { faststart: true, startTimesSeconds: [0, start] };
    const track = concatMp4(docs, options).tracks[0]!;
    const boundary = docs[0]!.tracks[0]!.samples.length;
    assert.equal(track.samples[boundary]!.pts / track.timescale, start);
    assert.equal(track.samples[boundary]!.dts / track.timescale, start);
    assert.deepEqual(track.decodedAudio!.channelData[0], Float32Array.from([
      ...docs[0]!.tracks[0]!.decodedAudio!.channelData[0]!,
      ...docs[1]!.tracks[0]!.decodedAudio!.channelData[0]!
    ]));
  });
}

for (const start of [2, 3, 1.4]) {
  it(`round-trips copied video at ${start}s while retaining all packets`, () => {
    const source = parseMp4(createSyntheticMp4({ width: 16, height: 16, fps: 5, frameCount: 10 }));
    const joined = concatMp4([source, source], { startTimesSeconds: [0, start] });
    const originalDts = joined.tracks[0]!.samples.map(sample => sample.dts);
    const track = parseMp4(serializeMp4(joined)).tracks[0]!;
    let previous = -1;
    const expected = originalDts.map(dts => (previous = Math.max(previous + 1, dts)));
    assert.deepEqual(track.samples.map(sample => sample.dts), expected);
    assert.deepEqual(track.samples.map(sample => sample.pts), expected);
    assert.deepEqual(track.samples.map(sample => sample.data), joined.tracks[0]!.samples.map(sample => sample.data));
    assert.deepEqual(joined.tracks[0]!.samples.map(sample => sample.dts), originalDts);
    assert.equal(track.samples.at(-1)!.pts / track.timescale, start + 1.8);
  });
}
