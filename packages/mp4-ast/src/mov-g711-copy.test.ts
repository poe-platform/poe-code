import assert from "node:assert/strict";
import { it } from "node:test";
import { parseMp4, serializeMp4 } from "./mp4.js";
import { rawAudioAsts } from "./containers/raw-audio.js";
import { parseWav, wavAst } from "./containers/adapters.js";

for (const [law, tag] of [["mulaw", "ulaw"], ["alaw", "alaw"]]) {
  for (const channels of [1, 2]) for (const container of ["raw", "wav"]) {
    it(`copies ${container} ${law} with ${channels} channels into a QuickTime sample entry`, () => {
      const bytes = Uint8Array.from({ length: 256 }, (_, i) => i);
      const raw = rawAudioAsts().find(ast => ast.id === law)!;
      const source = raw.parse(bytes, { sampleRate: 8000, channels, decodeAudio: false });
      const input = container === "wav" ? parseWav(wavAst().serialize(source, { audioCodec: "copy" }), { decodeAudio: false }) : source;
      const output = serializeMp4(input, { format: "mov" });
      const track = parseMp4(output, { decodeAudio: false }).tracks[0]!;
      assert.equal(track.codecDescriptions[0]!.formatFourCC, tag);
      assert.equal(track.codecDescriptions[0]!.codecName, `pcm_${law}`);
      assert.equal(track.codecDescriptions[0]!.channels, channels);
      assert.equal(track.codecDescriptions[0]!.sampleRate, 8000);
      assert.deepEqual(Buffer.concat(track.samples.map(sample => sample.data)), Buffer.from(bytes));
      const wave = wavAst().serialize(parseMp4(output, { decodeAudio: false }), { audioCodec: "copy" });
      assert.equal(parseWav(wave).tracks[0]!.codecDescriptions[0]!.codecName, `pcm_${law}`);
    });
  }
}

for (const law of ["mulaw", "alaw"]) {
  for (const sourceFormat of ["raw", "mov"]) {
    it(`rejects ${sourceFormat} ${law} packets in MP4`, () => {
      const raw = rawAudioAsts().find(ast => ast.id === law)!;
      const source = raw.parse(Uint8Array.from({ length: 256 }, (_, i) => i), { sampleRate: 8000, channels: 1 });
      const input = sourceFormat === "mov" ? parseMp4(serializeMp4(source, { format: "mov" })) : source;
      assert.throws(() => serializeMp4(input, { format: "mp4" }), {
        message: `Could not find tag for codec pcm_${law}, codec not currently supported in container mp4`
      });
    });
  }
}
