import assert from "node:assert/strict";
import { it } from "node:test";
import { encodeWav } from "@poe-code/audio-ast";
import { concatMp4, parseWav } from "./index.js";

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
