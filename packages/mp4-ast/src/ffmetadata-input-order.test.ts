import assert from "node:assert/strict";
import { it } from "node:test";
import { parseFfmetadata, serializeFfmetadata } from "./index.js";

for (const [name, input, expected] of [
  ["first key", "a=1\nb=2\nc=3\na=4", "c=3\nb=2\na=4"],
  ["case-insensitive key", "a=1\nb=2\nc=3\nA=4", "c=3\nb=2\nA=4"],
  ["middle key", "a=1\nb=2\nc=3\nd=4\nb=5", "a=1\nd=4\nc=3\nb=5"],
  ["last key", "a=1\nb=2\nc=3\nc=4", "a=1\nb=2\nc=4"],
  ["multiple replacements", "a=1\nb=2\nc=3\na=4\nc=5", "a=4\nb=2\nc=5"],
  ["recognized key", "title=1\nb=2\nc=3\nTITLE=4", "c=3\nb=2\nTITLE=4"],
  ["empty replacement", "a=1\nb=2\nc=3\na=", "c=3\nb=2\na="],
  ["unique control", "a=1\nb=2\nc=3", "a=1\nb=2\nc=3"]
]) {
  it(`preserves FFmetadata dictionary order after ${name}`, () => {
    const chapter = "[CHAPTER]\nTIMEBASE=1/10\nSTART=10\nEND=20\n";
    const suffix = "[CHAPTER]\nTIMEBASE=1/10\nSTART=20\nEND=30\na=unchanged\nb=unchanged\n";
    const bytes = new TextEncoder().encode(`;FFMETADATA1\n${input}\n${chapter}${input}\n${suffix}`);
    const document = parseFfmetadata(bytes);
    assert.equal(new TextDecoder().decode(serializeFfmetadata(document)),
      `;FFMETADATA1\n${expected}\n${chapter}${expected}\n${suffix}`);
  });
}
