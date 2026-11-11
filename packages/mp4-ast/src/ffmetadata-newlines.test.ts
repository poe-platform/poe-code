import assert from "node:assert/strict";
import { it } from "node:test";
import { ffmetadataAst, parseFfmetadata, serializeFfmetadata } from "./index.js";

for (const newline of ["\n", "\r\n"]) {
  it(`preserves escaped FFmetadata newlines with ${JSON.stringify(newline)} endings`, () => {
    const input = [";FFMETADATA1", "comment=line one\\", "line two\\", "#still the comment", "artist=next", "[CHAPTER]", "TIMEBASE=1/1000", "START=0", "END=1000", "title=chapter\\", "two"].join(newline);
    const doc = parseFfmetadata(new TextEncoder().encode(input));
    assert.equal(doc.metadata.comment, newline === "\n" ? "line one\nline two\n#still the comment" : "line one\r");
    assert.equal(doc.metadata.artist, "next");
    assert.equal(doc.chapters?.[0]?.title, newline === "\n" ? "chapter\ntwo" : "chapter\r");
    if (newline === "\n") {
      const roundTrip = parseFfmetadata(serializeFfmetadata(doc));
      assert.deepEqual(roundTrip.metadata, doc.metadata);
      assert.deepEqual(roundTrip.chapters, doc.chapters);
    }
  });
}

for (const count of [0, 1, 2, 3, 4]) {
  it(`continues FFmetadata records after ${count} backslashes before LF`, () => {
    const input = ";FFMETADATA1\na=b" + "\\".repeat(count) + "\nc=d\n";
    const doc = parseFfmetadata(new TextEncoder().encode(input));
    assert.deepEqual(doc.metadata.custom, count === 0
      ? { a: "b", c: "d" }
      : { a: "b" + "\\".repeat(Math.floor(count / 2)) + "\nc=d" });
    assert.equal(new TextDecoder().decode(serializeFfmetadata(doc)), count === 0
      ? input
      : ";FFMETADATA1\na=b" + "\\".repeat(2 * Math.floor(count / 2) + 1) + "\nc\\=d\n");
  });
}

for (const newline of ["\n", "\r\n"]) {
  it(`keeps the next tag separate after an escaped CR with ${JSON.stringify(newline)} endings`, () => {
    const doc = parseFfmetadata(new TextEncoder().encode([";FFMETADATA1", "a=b\\\r", "c=d", ""].join(newline)));
    assert.deepEqual(doc.metadata.custom, { a: "b\r", c: "d" });
    assert.equal(new TextDecoder().decode(serializeFfmetadata(doc)), ";FFMETADATA1\na=b\r\nc=d\n");
  });
}

for (const newline of ["\n", "\r\n", "\r"]) {
  it(`reads FFmetadata records terminated by ${JSON.stringify(newline)}`, () => {
    const input = new TextEncoder().encode(`;FFMETADATA1\na=b${newline}c=d${newline}`);
    const doc = parseFfmetadata(input);
    assert.deepEqual(doc.metadata.custom, { a: "b", c: "d" });
    assert.deepEqual(ffmetadataAst().probe!(input, {}).format.tags, { a: "b", c: "d" });
    assert.equal(new TextDecoder().decode(serializeFfmetadata(doc)), ";FFMETADATA1\na=b\nc=d\n");
  });
}
