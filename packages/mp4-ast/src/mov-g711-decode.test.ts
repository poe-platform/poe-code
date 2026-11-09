import assert from "node:assert/strict";
import { it } from "node:test";
import { parseMp4, serializeMp4 } from "./mp4.js";
import { rawAudioAsts } from "./containers/raw-audio.js";

for (const law of ["mulaw", "alaw"]) {
  for (const channels of [1, 2]) {
    it(`decodes ${channels}-channel MOV ${law} while allowing packet-only parsing`, () => {
      const raw = rawAudioAsts().find(ast => ast.id === law)!;
      const codes = Uint8Array.from({ length: 256 }, (_, i) => i);
      const source = raw.parse(codes, { sampleRate: 8000, channels });
      const bytes = serializeMp4(source, { format: "mov", audioCodec: "copy" });
      assert.deepEqual(parseMp4(bytes).tracks[0]!.decodedAudio, source.tracks[0]!.decodedAudio);
      const track = parseMp4(bytes, { decodeAudio: false }).tracks[0]!;
      assert.equal(track.decodedAudio, undefined);
      assert.deepEqual(Buffer.concat(track.samples.map(sample => sample.data)), Buffer.from(codes));
    });
  }
}
