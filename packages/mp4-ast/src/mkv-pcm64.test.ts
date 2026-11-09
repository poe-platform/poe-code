import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { parseMkv } from "./containers/mkv.js";
import { serializeWav } from "./containers/adapters.js";
import { readWavHeader } from "./containers/wav-header.js";

// FFmpeg 7.0.2: ffmpeg -i pcm64-acm.wav -c:a pcm_s64le pcm64-acm.mka
// The source includes low bits that cannot survive floating-point decoding.
const input = readFileSync(new URL("./fixtures/pcm64-acm.mka", import.meta.url));
const original = readFileSync(new URL("./fixtures/pcm64-acm.wav", import.meta.url));

it("identifies native Matroska ACM PCM64 and copies every sample bit to WAV without decoding", () => {
  const doc = parseMkv(input, { decodeAudio: false });
  const track = doc.tracks[0]!;
  const description = track.codecDescriptions[0]!;
  assert.equal(description.codecName, "pcm_s64le");
  assert.equal(description.sampleRate, 8000);
  assert.equal(description.channels, 1);
  assert.equal(description.bitsPerSample, 64);
  assert.equal(track.decodedAudio, undefined);
  assert.deepEqual(Buffer.concat(track.samples.map(sample => Buffer.from(sample.data))), original.subarray(44));
  // Matroska timestamps use integer milliseconds for these twelve samples.
  assert.equal(track.samples[0]!.duration, 1);
  const output = serializeWav(doc, { audioCodec: "copy" });
  const header = readWavHeader(output);
  assert.equal(header.formatTag, 1);
  assert.equal(header.bitsPerSample, 64);
  assert.deepEqual(Buffer.from(output.subarray(header.dataOffset, header.dataOffset + header.dataSize)), original.subarray(44));
});

for (const extension of ["short", "unknown GUID"] as const) {
  it(`does not identify a ${extension} ACM extension as PCM`, () => {
    const bytes = Buffer.from(input);
    const format = bytes.indexOf(Buffer.from("feff0100401f0000", "hex"));
    assert.notEqual(format, -1);
    if (extension === "short") bytes.writeUInt16LE(0, format + 16);
    else bytes[format + 39] = 0;
    assert.notEqual(parseMkv(bytes, { decodeAudio: false }).tracks[0]!.codecDescriptions[0]!.codecName, "pcm_s64le");
  });
}
