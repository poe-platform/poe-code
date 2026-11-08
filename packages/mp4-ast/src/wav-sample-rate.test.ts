import assert from "node:assert/strict";
import { it } from "node:test";
import { readWavHeader, readWavSourceHeader, readWavStreamHeader } from "./containers/wav-header.js";

for (const sampleRate of [0, 8000]) for (const littleEndian of [false, true]) {
  it(`${sampleRate ? "accepts valid" : "rejects zero"} sample rate in ${littleEndian ? "RIFF" : "RIFX"} readers`, async () => {
    const bytes = new Uint8Array(52);
    const view = new DataView(bytes.buffer);
    bytes.set(new TextEncoder().encode(littleEndian ? "RIFF" : "RIFX"));
    view.setUint32(4, 44, littleEndian);
    bytes.set(new TextEncoder().encode("WAVEfmt "), 8);
    view.setUint32(16, 16, littleEndian);
    view.setUint16(20, 1, littleEndian);
    view.setUint16(22, 1, littleEndian);
    view.setUint32(24, sampleRate, littleEndian);
    view.setUint32(28, 16000, littleEndian);
    view.setUint16(32, 2, littleEndian);
    view.setUint16(34, 16, littleEndian);
    bytes.set(new TextEncoder().encode("data"), 36);
    view.setUint32(40, 8, littleEndian);
    const source = { size: bytes.length, async read(offset: number, length: number) { return bytes.subarray(offset, offset + length); } };
    const stream = (async function* () { for (const byte of bytes) yield Uint8Array.of(byte); })();
    if (!sampleRate) {
      assert.throws(() => readWavHeader(bytes), /Invalid sample rate: 0/);
      await assert.rejects(readWavSourceHeader(source), /Invalid sample rate: 0/);
      await assert.rejects(readWavStreamHeader(stream), /Invalid sample rate: 0/);
    } else {
      assert.equal(readWavHeader(bytes).sampleRate, sampleRate);
      assert.equal((await readWavSourceHeader(source)).sampleRate, sampleRate);
      assert.equal((await readWavStreamHeader(stream)).sampleRate, sampleRate);
    }
  });
}
