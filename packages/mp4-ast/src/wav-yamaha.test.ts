import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { parseWav, serializeWav, wavAst, probeWavSource, probeWavStream } from "./containers/adapters.js";

for (const channels of [1, 2]) {
  const input = readFileSync(new URL(`../../safe-bash-command-ffmpeg/src/fixtures/wav-yamaha-${channels}.wav`, import.meta.url));
  const expected = readFileSync(new URL(`../../safe-bash-command-ffmpeg/src/fixtures/wav-yamaha-${channels}.pcm`, import.meta.url));
  it(`decodes ${channels}-channel Yamaha ADPCM exactly like native FFmpeg`, () => {
    const doc = parseWav(input);
    assert.equal(doc.duration, expected.length / (channels * 2));
    const audio = doc.tracks[0]!.decodedAudio!;
    for (let i = 0; i < doc.duration; i++) {
      for (let ch = 0; ch < channels; ch++) {
        assert.equal(audio.channelData[ch]![i]! * 32768, expected.readInt16LE((i * channels + ch) * 2));
      }
    }
  });

  it(`probes ${channels}-channel Yamaha ADPCM block durations through buffered, range and stream APIs`, async () => {
    const options = { showPackets: true };
    const probes = [await wavAst().probe!(input, options),
      await probeWavSource({ size: input.length, async read(offset, length) { return input.subarray(offset, offset + length); } }, options),
      await probeWavStream((async function* () { yield input; })(), options)];
    for (const probe of probes) {
      assert.equal(probe.streams[0]!.codec_name, "adpcm_yamaha");
      const packets = Array.from(probe.packets!);
      assert.equal(packets.reduce((n, p) => n + p.duration!, 0), expected.length / (channels * 2));
      assert.equal(packets.reduce((n, p) => n + Number(p.size), 0), expected.length / 4);
    }
  });

  it(`preserves ${channels}-channel Yamaha ADPCM when copying`, () => {
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

it("rejects unsupported Yamaha ADPCM channel counts and sample widths", () => {
  const input = readFileSync(new URL("../../safe-bash-command-ffmpeg/src/fixtures/wav-yamaha-1.wav", import.meta.url));
  const format = input.indexOf("fmt ") + 8;
  for (const [offset, value, message] of [[2, 3, /mono or stereo/], [14, 8, /sample width/]] as const) {
    const invalid = Buffer.from(input);
    invalid.writeUInt16LE(value, format + offset);
    assert.throws(() => parseWav(invalid), message);
  }
});
