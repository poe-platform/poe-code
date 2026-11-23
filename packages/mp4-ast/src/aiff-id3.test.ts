import assert from "node:assert/strict";
import { it } from "node:test";
import { encodeId3, parseId3 } from "@poe-code/audio-ast";
import { aiffAst, parseAiff, serializeAiff } from "./containers/aiff.js";

const plain = Buffer.from("464f524d0000003641494646434f4d4d000000120001000000040010400bfa0000000000000053534e440000001000000000000000000064ff38012cfe70", "hex");
const custom = { custom: "Value", note: "Draft", ...Object.fromEntries(["__proto__", "constructor", "toString"].map(key => [key, "Retained"])) };
const tags = { title: "Café 🎵", artist: "Performer", albumArtist: "Group", track: "2/9", disc: "1", ...custom };

for (const version of [3, 4] as const) {
  it(`keeps ID3v2.${version} track, disc and custom fields in AIFF metadata`, () => {
    const id3 = Buffer.from(encodeId3(tags, [], [], version));
    const chunk = Buffer.alloc(8 + id3.length + id3.length % 2);
    chunk.write("ID3 "); chunk.writeUInt32BE(id3.length, 4); id3.copy(chunk, 8);
    const bytes = Buffer.concat([plain, chunk]); bytes.writeUInt32BE(bytes.length - 8, 4);
    const doc = parseAiff(bytes);
    assert.equal(doc.metadata.trackNumber, "2/9");
    assert.equal(doc.metadata.discNumber, "1");
    assert.deepEqual(doc.metadata.custom, custom);
    assert.deepEqual(aiffAst().probe(bytes).format.tags, { title: "Café 🎵", artist: "Performer", album_artist: "Group", track: "2/9", disc: "1", ...custom });
    const output = Buffer.from(serializeAiff(doc, { audioCodec: "copy", writeId3v2: true, id3v2Version: version }));
    const offset = output.indexOf(Buffer.from("ID3 "));
    assert.ok(offset > 0);
    const written = output.subarray(offset + 8, offset + 8 + output.readUInt32BE(offset + 4));
    assert.deepEqual(parseId3(written).tags, tags);
  });
}

it("keeps ID3 custom fields when a later AUTH chunk replaces the author", () => {
  const id3 = Buffer.from(encodeId3({ note: "Draft", author: "Old" }));
  const chunk = Buffer.alloc(8 + id3.length + id3.length % 2);
  chunk.write("ID3 "); chunk.writeUInt32BE(id3.length, 4); id3.copy(chunk, 8);
  const author = Buffer.from("41555448000000034e657700", "hex");
  const bytes = Buffer.concat([plain, chunk, author]); bytes.writeUInt32BE(bytes.length - 8, 4);
  assert.deepEqual(parseAiff(bytes).metadata.custom, { note: "Draft", author: "New" });
});
