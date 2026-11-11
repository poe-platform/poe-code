import assert from "node:assert/strict";
import { it } from "node:test";
import { aiffAst, parseAiff, serializeAiff } from "./containers/aiff.js";

const plain = Buffer.from("464f524d0000003641494646434f4d4d000000120001000000040010400bfa0000000000000053534e440000001000000000000000000064ff38012cfe70", "hex");

for (const value of ["Speaker", "Studio", "Café", ""]) {
  it(`writes standard AIFF text chunks with byte lengths and padding for ${JSON.stringify(value)}`, () => {
    const doc = parseAiff(plain, { decodeAudio: false });
    const bytes = Buffer.from(serializeAiff(doc, { audioCodec: "copy",
      metadata: { custom: { author: value }, copyright: value, comment: value } }));
    const chunks = new Map<string, Buffer>();
    for (let offset = 12; offset < bytes.length;) {
      const size = bytes.readUInt32BE(offset + 4);
      chunks.set(bytes.toString("ascii", offset, offset + 4), bytes.subarray(offset + 8, offset + 8 + size));
      if (size % 2) assert.equal(bytes[offset + 8 + size], 0);
      offset += 8 + size + size % 2;
      assert.ok(offset <= bytes.length);
    }
    assert.equal(bytes.readUInt32BE(4), bytes.length - 8);
    assert.deepEqual([...chunks.keys()], value ? ["AUTH", "(c) ", "ANNO", "COMM", "SSND"] : ["COMM", "SSND"]);
    for (const id of ["AUTH", "(c) ", "ANNO"]) assert.deepEqual(chunks.get(id), value ? Buffer.from(value) : undefined);
    assert.deepEqual(chunks.get("SSND"), plain.subarray(46));
    assert.deepEqual(aiffAst().probe(bytes).format.tags ?? {}, value ? { author: value, copyright: value, comment: value } : {});
    assert.deepEqual(Buffer.from(serializeAiff(parseAiff(bytes, { decodeAudio: false }), { audioCodec: "copy" })), bytes);
  });
}
