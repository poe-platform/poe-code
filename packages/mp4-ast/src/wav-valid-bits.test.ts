import assert from "node:assert/strict";
import { it } from "node:test";
import { parseWav, probeWavSource, probeWavStream, serializeWav, wavAst } from "./index.js";
import fixtures from "../../../tests/fixtures/media/wav-valid-bits.json" with { type: "json" };

// Complete s32le outputs captured with FFmpeg 7.0.2, including wider storage slots.
for (const fixture of fixtures) {
  it(`decodes and probes extensible WAV ${fixture.name} like native FFmpeg`, async () => {
    const input = Buffer.from(fixture.input, "hex");
    const expected = Buffer.from(fixture.s32le, "hex");
    const decoded = parseWav(input);
    const samples = decoded.tracks[0]!.decodedAudio!.channelData[0]!;
    assert.deepEqual(Array.from(samples, sample => sample * 2147483648),
      Array.from({ length: expected.length / 4 }, (_, i) => expected.readInt32LE(i * 4)));
    const source = { size: input.length, async read(offset: number, length: number) {
      return input.subarray(offset, offset + Math.min(length, 3));
    } };
    for (const probe of [wavAst().probe(input), await probeWavSource(source),
      await probeWavStream((async function* () { for (const byte of input) yield Uint8Array.of(byte); })())]) {
      assert.equal(probe.streams[0]!.codec_name, fixture.codec);
      assert.equal(probe.streams[0]!.duration_ts, samples.length);
    }
    if (fixture.codec !== "pcm_f24le") {
      const copy = serializeWav(parseWav(input, { decodeAudio: false }), { audioCodec: "copy" });
      assert.deepEqual(parseWav(copy).tracks[0]!.decodedAudio!.channelData, decoded.tracks[0]!.decodedAudio!.channelData);
    }
  });
}
