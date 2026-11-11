import assert from "node:assert/strict";
import { it } from "node:test";
import { aiffAst, parseAiff, serializeAiff } from "./containers/aiff.js";
const native = Buffer.from("464f524d0000004041494646434f4d4d000000120001000000090010400bfa0000000000000053534e440000001a00000000000000008000bffffeffffff00000001010140017fff", "hex");
const aifc = Buffer.from("464f524d00000058414946434656455200000004a28051404e414d45000000064e6565646c65434f4d4d000000180001000000050010400bfa00000000000000736f7774000053534e440000001200000000000000000080fffe00000101ff7f", "hex");

for (const title of ["Needle", "Odd", "Café"]) {
  it(`writes a padded NAME chunk and preserves title ${title} on copy`, () => {
    const doc = parseAiff(native);
    const bytes = Buffer.from(serializeAiff(doc, { metadata: { title } }));
    const offset = 12;
    const encoded = Buffer.from(title);
    assert.equal(bytes.toString("ascii", offset, offset + 4), "NAME");
    assert.equal(bytes.readUInt32BE(offset + 4), encoded.length);
    assert.deepEqual(bytes.subarray(offset + 8, offset + 8 + encoded.length), encoded);
    assert.equal(bytes.length, native.length + 8 + encoded.length + encoded.length % 2);
    assert.equal(bytes.readUInt32BE(4), bytes.length - 8);
    const parsed = parseAiff(bytes, { decodeAudio: false });
    assert.equal(parsed.metadata.title, title);
    assert.equal(aiffAst().probe(bytes).format.tags?.title, title);
    assert.deepEqual(Buffer.from(serializeAiff(parsed, { audioCodec: "copy" })), bytes);
    assert.deepEqual(parseAiff(bytes).tracks[0]!.decodedAudio, doc.tracks[0]!.decodedAudio);
  });
}

it("reads title from native AIFF-C NAME chunk", () => {
  assert.equal(parseAiff(aifc).metadata.title, "Needle");
});
