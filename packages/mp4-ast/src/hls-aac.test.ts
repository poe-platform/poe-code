import assert from "node:assert/strict";
import { it } from "node:test";
import { concatBytes } from "./binary.js";
import { wrapAdtsFrame } from "./codecs.js";
import { hlsAst, parseMp4, serializeMp4 } from "./index.js";

for (const channels of [1, 2]) {
  it(`demuxes packed AAC HLS segments with ${channels} channels`, () => {
    const payloads = [new Uint8Array([1, 2, 3]), new Uint8Array([4, 5]), new Uint8Array([6, 7, 8, 9])];
    const frames = payloads.map(payload => wrapAdtsFrame(payload, 48000, channels));
    const resources = new Map([
      ["first.bin", concatBytes(frames.slice(0, 2))],
      ["second.bin", frames[2]!]
    ]);
    const playlist = new TextEncoder().encode('#EXTM3U\n#EXTINF:0.042667,\nfirst.bin\n#EXTINF:0.021333,\nsecond.bin\n#EXT-X-ENDLIST\n');
    const doc = hlsAst().parse(playlist, { resolveResource: uri => resources.get(uri)! });
    const output = parseMp4(serializeMp4(doc));
    assert.equal(output.tracks.length, 1);
    const track = output.tracks[0]!;
    assert.equal(track.type, "audio");
    assert.equal(track.codecDescriptions[0]!.codecName, "aac");
    assert.equal(track.codecDescriptions[0]!.sampleRate, 48000);
    assert.equal(track.codecDescriptions[0]!.channels, channels);
    assert.deepEqual(track.samples.map(s => s.data), payloads);
    assert.deepEqual(track.samples.map(s => s.dts), [0, 1024, 2048]);
    assert.deepEqual(track.samples.map(s => s.duration), [1024, 1024, 1024]);
  });
}
