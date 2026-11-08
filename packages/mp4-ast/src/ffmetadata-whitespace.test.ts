import assert from "node:assert/strict";
import { it } from "node:test";
import { parseFfmetadata, serializeFfmetadata } from "./index.js";

for (const newline of ["\n", "\r\n"]) {
  it(`preserves FFmetadata value whitespace with ${JSON.stringify(newline)} line endings`, () => {
    const document = parseFfmetadata(new TextEncoder().encode([
      ";FFMETADATA1", "title=  take 1  ", "artist=\t artist\t", "comment=   ",
      "[CHAPTER]", "TIMEBASE=1/1000", "START=0", "END=1000", "title=  chapter  "
    ].join(newline)));
    assert.equal(document.metadata.title, "  take 1  ");
    assert.equal(document.metadata.artist, "\t artist\t");
    assert.equal(document.metadata.comment, "   ");
    assert.equal(document.chapters?.[0]?.title, "  chapter  ");
    const roundTrip = parseFfmetadata(serializeFfmetadata(document));
    assert.deepEqual(roundTrip.metadata, document.metadata);
    assert.deepEqual(roundTrip.chapters, document.chapters);
  });
}
