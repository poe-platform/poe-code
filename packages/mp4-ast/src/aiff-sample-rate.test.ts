import assert from "node:assert/strict";
import { it } from "node:test";
import { aiffAst, parseAiff } from "./containers/aiff.js";

function input(rate: number): Buffer {
  const bytes = Buffer.from("464f524d0000003641494646434f4d4d000000120001000000040010400bfa0000000000000053534e440000001000000000000000000064ff38012cfe70", "hex");
  const exponent = Math.floor(Math.log2(Math.abs(rate)));
  bytes.writeUInt16BE((rate < 0 ? 0x8000 : 0) | (16383 + exponent), 28);
  bytes.writeBigUInt64BE(BigInt(Math.abs(rate) * 2 ** (63 - exponent)), 30);
  return bytes;
}

for (const [rate, rounded] of [[8000, 8000], [8000.25, 8000], [8000.5, 8001], [8000.75, 8001]] as const) {
  it(`rounds AIFF sample rate ${rate} to ${rounded} without changing PCM`, () => {
    const bytes = input(rate);
    assert.equal(aiffAst().probe(bytes).streams[0]!.sample_rate, String(rounded));
    const doc = parseAiff(bytes);
    assert.equal(doc.durationSeconds, 4 / rounded);
    assert.equal(doc.tracks[0]!.decodedAudio!.sampleRate, rounded);
    assert.deepEqual(Array.from(doc.tracks[0]!.decodedAudio!.channelData[0]!, value => value * 32768), [100, -200, 300, -400]);
  });
}

for (const rate of [-8000.5, 0.25, 2 ** 54]) {
  it(`rejects invalid AIFF sample rate ${rate}`, () => {
    assert.throws(() => parseAiff(input(rate)), /Invalid AIFF sample rate/);
  });
}
