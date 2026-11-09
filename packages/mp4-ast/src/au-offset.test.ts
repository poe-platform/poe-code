import assert from "node:assert/strict";
import { it } from "node:test";
import { auAst } from "./containers/au.js";

for (const offset of [1, 16, 23, 24, 25, 0x80000000, 0xfffffffe, 0xffffffff]) {
  it(`reads AU audio after the complete header for offset ${offset}`, () => {
    const start = offset === 25 ? 25 : 24;
    const payload = Buffer.from("000101fffc1903e8", "hex");
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
        [1, 511, -999, 1000].map(value => value / 32768));
    }
    assert.equal(Number(auAst().probe(bytes).streams[0]!.duration_ts), 4);
  });
}

for (const offset of [0, 100, 0x7fffffff]) {
  it(`rejects AU offset ${offset} outside the available data`, () => {
    const bytes = Buffer.from("2e736e6400000018000000080000000300001f4000000001000101fffc1903e8", "hex");
    bytes.writeUInt32BE(offset, 4);
    for (const decodeAudio of [true, false]) {
      assert.throws(() => auAst().parse(bytes, { decodeAudio }), /Invalid AU data bounds/);
    }
    assert.throws(() => auAst().probe(bytes), /Invalid AU data bounds/);
  });
}
