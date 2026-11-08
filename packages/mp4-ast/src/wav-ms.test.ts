import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { parseWav, serializeWav, wavAst, probeWavSource, probeWavStream } from "./containers/adapters.js";

for (const channels of [1, 2]) {
  const input = readFileSync(new URL(`../../safe-bash-command-ffmpeg/src/fixtures/wav-ms-${channels}.wav`, import.meta.url));
  const expected = readFileSync(new URL(`../../safe-bash-command-ffmpeg/src/fixtures/wav-ms-${channels}.pcm`, import.meta.url));
  it(`decodes ${channels}-channel Microsoft ADPCM exactly like native FFmpeg`, () => {
    const doc = parseWav(input);
    assert.equal(doc.duration, expected.length / (channels * 2));
    const audio = doc.tracks[0]!.decodedAudio!;
    for (let i = 0; i < doc.duration; i++) {
      for (let ch = 0; ch < channels; ch++) {
        assert.equal(audio.channelData[ch]![i]! * 32768, expected.readInt16LE((i * channels + ch) * 2));
      }
    }
  });

  it(`decodes a partial final ${channels}-channel MS ADPCM block`, () => {
    const start = input.indexOf("data") + 8;
    const size = channels * 7 + 10;
    const partial = Buffer.from(input.subarray(0, start + size));
    partial.writeUInt32LE(size, start - 4);
    partial.writeUInt32LE(partial.length - 8, 4);
    const doc = parseWav(partial);
    assert.equal(doc.duration, 2 + 20 / channels);
    for (let i = 0; i < doc.duration; i++) {
      for (let ch = 0; ch < channels; ch++) {
        assert.equal(doc.tracks[0]!.decodedAudio!.channelData[ch]![i]! * 32768,
          expected.readInt16LE((i * channels + ch) * 2));
      }
    }
    const truncated = partial.subarray(0, start + channels * 7 - 1);
    assert.throws(() => parseWav(truncated), /block size/);
  });

  it(`probes ${channels}-channel MS ADPCM block durations through buffered, range and stream APIs`, async () => {
    const options = { showPackets: true };
    const probes = [await wavAst().probe!(input, options),
      await probeWavSource({ size: input.length, async read(offset, length) { return input.subarray(offset, offset + length); } }, options),
      await probeWavStream((async function* () { yield input; })(), options)];
    for (const probe of probes) {
      assert.equal(probe.streams[0]!.codec_name, "adpcm_ms");
      const packets = Array.from(probe.packets!);
      assert.equal(packets.length, channels === 1 ? 3 : 5);
      assert.equal(packets.reduce((n, p) => n + p.duration!, 0), expected.length / (channels * 2));
      assert.ok(packets.every(p => p.size === "1024"));
    }
  });

  it(`preserves ${channels}-channel MS ADPCM when copying`, () => {
    const doc = parseWav(input, { decodeAudio: false });
    assert.equal(doc.tracks[0]!.decodedAudio, undefined);
    const copy = Buffer.from(serializeWav(doc, { audioCodec: "copy" }));
    for (const chunk of ["fmt ", "fact", "data"]) {
      const offset = input.indexOf(chunk) + 8;
      const size = input.readUInt32LE(offset - 4);
      const start = copy.indexOf(chunk) + 8;
      assert.deepEqual(copy.subarray(start, start + size), input.subarray(offset, offset + size));
    }
  });
}

it("rejects invalid MS ADPCM block headers and sample widths", () => {
  const input = readFileSync(new URL("../../safe-bash-command-ffmpeg/src/fixtures/wav-ms-1.wav", import.meta.url));
  const format = input.indexOf("fmt ") + 8;
  for (const [offset, value, message] of [
    [input.indexOf("data") + 8, 7, /predictor/],
    [format + 12, 6, /block size/],
    [format + 2, 3, /mono or stereo/],
    [format + 14, 8, /sample width/]
  ] as const) {
    const invalid = Buffer.from(input);
    if (offset === input.indexOf("data") + 8) invalid[offset] = value;
    else invalid.writeUInt16LE(value, offset);
    assert.throws(() => parseWav(invalid), message);
  }
});
