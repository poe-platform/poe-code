import assert from "node:assert/strict";
import { it } from "node:test";
import { parseFfmetadata, serializeFfmetadata } from "./index.js";

for (const newline of ["\n", "\r\n"]) {
  it(`preserves escaped FFmetadata newlines with ${JSON.stringify(newline)} endings`, () => {
    const input = [";FFMETADATA1", "comment=line one\\", "line two\\", "#still the comment", "artist=next", "[CHAPTER]", "TIMEBASE=1/1000", "START=0", "END=1000", "title=chapter\\", "two"].join(newline);
    const doc = parseFfmetadata(new TextEncoder().encode(input));
    assert.equal(doc.metadata.comment, "line one\nline two\n#still the comment");
    assert.equal(doc.metadata.artist, "next");
    assert.equal(doc.chapters?.[0]?.title, "chapter\ntwo");
    const roundTrip = parseFfmetadata(serializeFfmetadata(doc));
    assert.deepEqual(roundTrip.metadata, doc.metadata);
    assert.deepEqual(roundTrip.chapters, doc.chapters);
  });
}

it("keeps escaped backslashes separate from newline continuations", () => {
  const doc = parseFfmetadata(new TextEncoder().encode(";FFMETADATA1\ncomment=path\\\\\nartist=next\n"));
  assert.equal(doc.metadata.comment, "path\\");
  assert.equal(doc.metadata.artist, "next");
  assert.equal(new TextDecoder().decode(serializeFfmetadata(doc)), ";FFMETADATA1\nartist=next\ncomment=path\\\\\n");
});
