import assert from "node:assert/strict";
import { it } from "node:test";
import { parseWav, wavAst } from "./containers/adapters.js";

for (const [tag, codec, payload, expected] of [
  [7, "pcm_mulaw", "000f677effffe78f80", [-32124, -16764, -260, -8, 0, 0, 260, 16764, 32124]],
  [6, "pcm_alaw", "2a3a4555d5d5c5baaa", [-32256, -16128, -264, -8, 8, 8, 264, 16128, 32256]]
] as const) {
  const input = Buffer.from("524946463c00000057415645666d74201200000007000100401f0000401f00000100080000006661637404000000090000006461746109000000000f677fffffe78f8000", "hex");
  input.writeUInt16LE(tag, 20);
  Buffer.from(payload, "hex").copy(input, 58);
  it(`decodes ${codec} WAV samples`, () => {
    const track = parseWav(input).tracks[0]!;
    assert.deepEqual(Array.from(track.decodedAudio!.channelData[0]!, n => n * 32768), expected);
  });
  it(`identifies ${codec} without decoding`, async () => {
    assert.equal(parseWav(input, { decodeAudio: false }).tracks[0]!.codecDescriptions[0]!.codecName, codec);
    const probe = await wavAst().probe!(input);
    assert.equal(probe.streams[0]!.codec_name, codec);
  });
}
