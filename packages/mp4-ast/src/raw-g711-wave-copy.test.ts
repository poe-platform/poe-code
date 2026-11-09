import assert from "node:assert/strict";
import { it } from "node:test";
import { rawAudioAsts } from "./containers/raw-audio.js";
import { parseWav, wavAst } from "./containers/adapters.js";
import { readWavHeader } from "./containers/wav-header.js";

for (const format of ["wav", "w64"] as const) {
  for (const [law, tag] of [["mulaw", 7], ["alaw", 6], ["u8", 1]] as const) {
    it(`stream-copies raw ${law} into ${format} with its codec and samples intact`, () => {
      const input = Uint8Array.from({ length: 256 }, (_, i) => i);
      const raw = rawAudioAsts().find(ast => ast.id === law)!;
      const source = raw.parse(input, { sampleRate: 8000, channels: 1, decodeAudio: false });
      const output = wavAst(format).serialize(source, { audioCodec: "copy" });
      const header = readWavHeader(output);
      assert.equal(header.formatTag, tag);
      assert.equal(header.sampleRate, 8000);
      assert.equal(header.channels, 1);
      assert.deepEqual(output.subarray(header.dataOffset, header.dataOffset + header.dataSize), input);
      const track = parseWav(output).tracks[0]!;
      assert.equal(track.codecDescriptions[0]!.codecName, `pcm_${law}`);
      assert.deepEqual(Array.from(track.decodedAudio!.channelData[0]!),
        Array.from(raw.parse(input, { sampleRate: 8000, channels: 1 }).tracks[0]!.decodedAudio!.channelData[0]!));
      const copied = wavAst(format).serialize(parseWav(output, { decodeAudio: false }), { audioCodec: "copy" });
      assert.deepEqual(copied, output);
    });
  }
}
