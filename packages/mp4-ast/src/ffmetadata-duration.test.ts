import assert from "node:assert/strict";
import { it } from "node:test";
import { ffmetadataAst } from "./index.js";

it("omits unknown duration and bit rate for chapterless FFmetadata", () => {
  for (const tags of ["", "title=Control\n"]) {
    const bytes = new TextEncoder().encode(`;FFMETADATA1\n${tags}`);
    const result = ffmetadataAst().probe!(bytes, {});
    assert.equal(Object.hasOwn(result.format, "duration"), false);
    assert.equal(Object.hasOwn(result.format, "bit_rate"), false);
    assert.equal(result.format.size, String(bytes.length));
    assert.deepEqual(result.chapters, []);
  }
});

it("preserves measured FFmetadata chapter duration and bit rate", () => {
  const bytes = new TextEncoder().encode(";FFMETADATA1\ntitle=Control\n[CHAPTER]\nTIMEBASE=1/1000\nSTART=0\nEND=400\n");
  const result = ffmetadataAst().probe!(bytes, {});
  assert.equal(result.format.duration, "0.400000");
  assert.equal(result.format.bit_rate, "1380");
  assert.deepEqual(result.format.tags, { title: "Control" });
});
