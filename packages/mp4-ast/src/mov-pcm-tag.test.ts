import assert from "node:assert/strict";
import { it } from "node:test";
import { parseMp4, serializeMp4 } from "./mp4.js";
import { rawAudioAsts } from "./containers/raw-audio.js";
import { cafAst } from "./containers/caf.js";

for (const [format, tag] of [["s16le", "sowt"], ["s16be", "twos"]] as const) {
  for (const container of ["raw", "caf"]) {
    it(`tags ${container} ${format} samples correctly in MOV`, () => {
      const bytes = Uint8Array.from({ length: 32800 }, (_, i) => i % 251);
      const raw = rawAudioAsts().find(ast => ast.id === format)!;
      const source = raw.parse(bytes, { sampleRate: 8000, channels: 2, decodeAudio: false });
      const input = container === "caf" ? cafAst().parse(cafAst().serialize(source, { audioCodec: "copy" }), { decodeAudio: false }) : source;
      const track = parseMp4(serializeMp4(input, { format: "mov" }), { decodeAudio: false }).tracks[0]!;
      assert.equal(track.codecDescriptions[0]!.formatFourCC, tag);
      assert.equal(track.codecDescriptions[0]!.codecName, `pcm_${format}`);
      assert.equal(track.codecDescriptions[0]!.channels, 2);
      assert.equal(track.codecDescriptions[0]!.sampleRate, 8000);
      assert.deepEqual(Buffer.concat(track.samples.map(sample => sample.data)), Buffer.from(bytes));
      assert.equal(track.decodedAudio, undefined);
      const decoded = parseMp4(serializeMp4(input, { format: "mov" }));
      assert.equal(decoded.tracks[0]!.decodedAudio?.sampleRate, 8000);
      assert.equal(decoded.tracks[0]!.decodedAudio?.channels, 2);
      assert.deepEqual(Buffer.from(raw.serialize(decoded)), Buffer.from(bytes));
    });
  }
}
