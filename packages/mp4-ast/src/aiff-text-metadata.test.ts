import assert from "node:assert/strict";
import { it } from "node:test";
import { aiffAst, parseAiff } from "./containers/aiff.js";

// AIFF with NAME, AUTH, (c) and ANNO chunks and four signed PCM samples.
const input = Buffer.from("464f524d0000007241494646434f4d4d000000120001000000040010400bfa000000000000004e414d4500000004536f6e6741555448000000064172746973742863292000000009436f7079726967687400414e4e4f00000007436f6d6d656e740053534e440000001000000000000000000064ff38012cfe70", "hex");

it("reads AIFF text chunks as native FFmpeg tags without changing PCM", () => {
  const doc = parseAiff(input);
  assert.equal(doc.metadata.title, "Song");
  assert.equal(doc.metadata.custom?.author, "Artist");
  assert.equal(doc.metadata.copyright, "Copyright");
  assert.equal(doc.metadata.comment, "Comment");
  assert.deepEqual(aiffAst().probe(input).format.tags, {
    title: "Song", author: "Artist", copyright: "Copyright", comment: "Comment"
  });
  assert.deepEqual(Array.from(doc.tracks[0]!.decodedAudio!.channelData[0]!), [100, -200, 300, -400].map(value => value / 32768));
});
