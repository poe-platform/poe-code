import assert from "node:assert/strict";
import { it } from "node:test";
import { parseWav } from "./index.js";
import { readWavSourceHeader, readWavStreamHeader } from "./containers/wav-header.js";

for (const changedByte of [undefined, ...Array.from({ length: 14 }, (_, i) => i + 46)]) {
  it(`validates the entire extensible WAV GUID (${changedByte ?? "standard PCM"})`, async () => {
    const input = Buffer.from("524946464400000057415645666d742028000000feff0100401f0000803e00000200100016001000040000000100000000001000800000aa00389b71646174610800000064009cffc80038ff", "hex");
    if (changedByte !== undefined) input[changedByte] = input[changedByte]! ^ 1;
    const source = { size: input.length, async read(offset: number, length: number) {
      return input.subarray(offset, offset + Math.min(length, 3));
    } };
    const stream = (async function* () {
      for (const byte of input) yield Uint8Array.of(byte);
    })();
    if (changedByte === undefined) {
      assert.deepEqual(Array.from(parseWav(input).tracks[0]!.decodedAudio!.channelData[0]!, n => n * 32768), [100, -100, 200, -200]);
      assert.equal((await readWavSourceHeader(source)).formatTag, 1);
      assert.equal((await readWavStreamHeader(stream)).formatTag, 1);
    } else {
      assert.throws(() => parseWav(input), /Unsupported WAV subformat GUID/);
      await assert.rejects(readWavSourceHeader(source), /Unsupported WAV subformat GUID/);
      await assert.rejects(readWavStreamHeader(stream), /Unsupported WAV subformat GUID/);
    }
  });
}
