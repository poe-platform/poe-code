import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { parseAvi } from "./containers/avi.js";

// Native FFmpeg 7.0.2: 48x32 MPEG-4 video with mono 16 kHz IMA ADPCM audio.
const fixture = readFileSync(new URL("./fixtures/ima-adpcm.avi", import.meta.url));
const formatOffset = fixture.indexOf("strf", fixture.indexOf("auds")) + 8;

it("retains AVI IMA ADPCM format, block extension, packets and sample timing", () => {
  const audio = parseAvi(fixture, { decodeAudio: false }).tracks[1]!;
  const description = audio.codecDescriptions[0]!;
  assert.equal(description.codecName, "adpcm_ima_wav");
  assert.equal(description.formatFourCC, "\x11\0\0\0");
  assert.equal(description.channels, 1);
  assert.equal(description.sampleRate, 16000);
  assert.equal(description.bitsPerSample, 4);
  assert.deepEqual(description.rawWavFormatBytes, fixture.subarray(formatOffset, formatOffset + 20));
  assert.equal(audio.duration, 14287);
  assert.deepEqual(audio.samples.map(sample => [sample.size, sample.dts, sample.duration]),
    Array.from({ length: 7 }, (_, index) => [1024, index * 2041, 2041]));
});

for (const [channels, blockAlign, frames] of [[1, 256, 2020], [2, 512, 1010]] as const) {
  it(`uses ${channels}-channel ${blockAlign}-byte IMA blocks for AVI packet timing`, () => {
    const input = Buffer.from(fixture);
    input.writeUInt16LE(channels, formatOffset + 2);
    input.writeUInt16LE(blockAlign, formatOffset + 12);
    input.writeUInt16LE(505, formatOffset + 18);
    const audio = parseAvi(input, { decodeAudio: false }).tracks[1]!;
    assert.deepEqual(audio.samples.map(sample => sample.duration), Array(7).fill(frames));
    assert.equal(audio.duration, frames * 7);
  });
}
