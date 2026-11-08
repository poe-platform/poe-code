import assert from "node:assert/strict";
import { it } from "node:test";
import { encodeWav } from "@poe-code/audio-ast";
import { parseWav, serializeWav } from "./containers/adapters.js";

for (const [audioCodec, tag] of [["aac", 255], ["mp3", 85]] as const) {
  for (const [sampleRate, channels, count] of [[8000, 1, 9], [44100, 2, 4097]] as const) {
    it(`encodes ${sampleRate} Hz ${channels} channel PCM as ${audioCodec} in WAV`, () => {
      const input = encodeWav({ sampleRate, channels: Array.from({ length: channels }, () =>
        Float64Array.from({ length: count }, (_, i) => Math.sin(i * 0.4) * 0.8)) });
      const output = serializeWav(parseWav(input), { audioCodec });
      assert.equal(new DataView(output.buffer, output.byteOffset).getUint16(20, true), tag);
      const decoded = parseWav(output).tracks[0]!;
      assert.equal(decoded.codecDescriptions[0]!.codecName, audioCodec);
      assert.equal(decoded.decodedAudio!.sampleRate, sampleRate);
      assert.equal(decoded.decodedAudio!.channels, channels);
      assert.ok(decoded.decodedAudio!.channelData[0]!.length >= count);
      assert.ok(decoded.decodedAudio!.channelData[0]!.some(value => Math.abs(value) > 0.01));
    });
  }
}
