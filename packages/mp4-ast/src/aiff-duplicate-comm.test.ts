import assert from "node:assert/strict";
import { it } from "node:test";
import { aiffAst, parseAiff } from "./containers/aiff.js";

function input(duplicate: boolean): Buffer {
  const bytes = Buffer.from("464f524d0000003641494646434f4d4d000000120001000000040010400bfa0000000000000053534e440000001000000000000000000064ff38012cfe70", "hex");
  if (!duplicate) return bytes;
  const finalComm = Buffer.from(bytes.subarray(12, 38));
  finalComm.writeUInt16BE(0x400a, 16); // 4000 Hz instead of 8000 Hz.
  const result = Buffer.concat([bytes.subarray(0, 38), finalComm, bytes.subarray(38)]);
  result.writeUInt32BE(result.length - 8, 4);
  return result;
}

for (const duplicate of [false, true]) {
  it(`uses the ${duplicate ? "final" : "single"} AIFF COMM header for decoding and probing`, () => {
    const bytes = input(duplicate);
    const rate = duplicate ? 4000 : 8000;
    const doc = parseAiff(bytes);
    assert.equal(doc.durationSeconds, 4 / rate);
    assert.equal(doc.tracks[0]!.decodedAudio!.sampleRate, rate);
    assert.deepEqual(Array.from(doc.tracks[0]!.decodedAudio!.channelData[0]!, value => value * 32768), [100, -200, 300, -400]);
    assert.equal(aiffAst().probe(bytes).streams[0]!.sample_rate, String(rate));
  });
}

it("still rejects a truncated second COMM header", () => {
  const bytes = input(true);
  bytes.writeUInt32BE(16, 42);
  assert.throws(() => parseAiff(bytes), /Invalid AIFF COMM chunk/);
});
