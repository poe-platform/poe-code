import assert from "node:assert/strict";
import { it } from "node:test";
import { auAst } from "./containers/au.js";

for (const offset of [1, 16, 23, 24, 25]) {
  it(`reads AU audio after the complete header for offset ${offset}`, () => {
    const start = Math.max(24, offset);
    const payload = Buffer.from("0064ff38012cfe70", "hex");
    const bytes = Buffer.alloc(start + payload.length);
    [0x2e736e64, offset, payload.length, 3, 8000, 1].forEach((value, i) => bytes.writeUInt32BE(value, i * 4));
    payload.copy(bytes, start);
    for (const decodeAudio of [true, false]) {
      const doc = auAst().parse(bytes, { decodeAudio });
      const track = doc.tracks[0]!;
      assert.deepEqual(Buffer.concat(track.samples.map(sample => sample.data)), payload);
      assert.equal(track.samples[0]!.offset, start);
      assert.deepEqual(doc.metadata, {});
      if (decodeAudio) assert.deepEqual(Array.from(track.decodedAudio!.channelData[0]!),
        [100, -200, 300, -400].map(value => value / 32768));
    }
    assert.equal(Number(auAst().probe(bytes).streams[0]!.duration_ts), 4);
  });
}
