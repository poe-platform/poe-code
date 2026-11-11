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

for (const key of ["key", "title"]) {
  for (const paddedKey of [` ${key}`, `${key} `, `\t${key}\t`]) {
    it(`preserves distinct global and chapter FFmetadata keys: ${JSON.stringify(paddedKey)}`, () => {
      const tags = `${key}=plain\n${paddedKey}=padded\n`;
      const input = `;FFMETADATA1\n${tags}[CHAPTER]\nTIMEBASE=1/1000\nSTART=1000\nEND=3000\n${tags}`;
      const document = parseFfmetadata(new TextEncoder().encode(input));
      assert.equal(document.metadata.custom?.[paddedKey], "padded");
      assert.equal(key === "title" ? document.metadata.title : document.metadata.custom?.[key], "plain");
      assert.deepEqual(document.chapters?.[0]?.tags, { [key]: "plain", [paddedKey]: "padded" });
      const output = serializeFfmetadata(document);
      assert.equal(new TextDecoder().decode(output), input);
      assert.equal(new TextDecoder().decode(serializeFfmetadata(parseFfmetadata(output))), input);
    });
  }
}
