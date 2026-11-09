import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { parseWav } from "./containers/adapters.js";
import { serializeAvi } from "./containers/avi.js";

const doc = parseWav(readFileSync(new URL("./fixtures/avi-ima.wav", import.meta.url)), { decodeAudio: false });
const track = doc.tracks[0]!;
const desc = track.codecDescriptions[0]!;

for (const channels of [1, 2]) for (const blockAlign of [32, 256, 1024]) {
  it(`retains ${channels}-channel IMA format and ${blockAlign}-byte block clock`, () => {
    const format = Buffer.from(desc.rawWavFormatBytes!);
    format.writeUInt16LE(channels, 2);
    format.writeUInt32LE(8000 * channels, 8);
    format.writeUInt16LE(blockAlign, 12);
    format.writeUInt16LE(1 + (blockAlign - channels * 4) * 2 / channels, 18);
    const samples = track.samples.slice(0, 2).map(sample => ({ ...sample,
      data: new Uint8Array(blockAlign), size: blockAlign }));
    const output = Buffer.from(serializeAvi({ ...doc, tracks: [{ ...track, samples,
      codecDescriptions: [{ ...desc, channels, rawWavFormatBytes: format }] }] }));
    const strf = output.indexOf("strf");
    assert.deepEqual(output.subarray(strf + 8, strf + 8 + output.readUInt32LE(strf + 4)), format);
    const strh = output.indexOf("strh") + 8;
    assert.equal(output.readUInt32LE(strh + 20) / output.readUInt32LE(strh + 24), blockAlign / (8000 * channels));
    assert.equal(output.readUInt32LE(strh + 32), 2);
    assert.equal(output.readUInt32LE(strh + 44), blockAlign);
  });
}

it("does not insert an AAC packet into empty IMA audio", () => {
  const output = Buffer.from(serializeAvi({ ...doc, tracks: [{ ...track, samples: [], duration: 0 }] }));
  assert.equal(output.readUInt32LE(output.indexOf("idx1") + 4), 0);
});

for (const rawWavFormatBytes of [undefined, new Uint8Array(16), new Uint8Array(20)]) {
  it(`rejects missing or invalid IMA WAVEFORMATEX (${rawWavFormatBytes?.length})`, () => {
    assert.throws(() => serializeAvi({ ...doc, tracks: [{ ...track,
      codecDescriptions: [{ ...desc, rawWavFormatBytes }] }] }), /IMA ADPCM.*format/);
  });
}
