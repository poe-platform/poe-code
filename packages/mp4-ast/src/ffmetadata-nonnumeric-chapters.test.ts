import assert from "node:assert/strict";
import { it } from "node:test";
import { parseFfmetadata, serializeFfmetadata } from "./index.js";

for (const [start, end, expected] of [
  ["10", "bad", "START=10\nEND=10\n"],
  ["bad", "20", "START=0\nEND=0\nEND=20\n"],
  ["10", "20", "START=10\nEND=20\n"],
  ["10", "", "START=10\nEND=10\n"],
  ["", "20", "START=0\nEND=0\nEND=20\n"],
  ["10tail", "20tail", "START=10\nEND=20\n"]
]) {
  it(`recovers chapter START=${start} END=${end}`, () => {
    const document = parseFfmetadata(new TextEncoder().encode(
      `;FFMETADATA1\n[CHAPTER]\nTIMEBASE=1/10\nSTART=${start}\nEND=${end}\ntitle=One\n`));
    assert.equal(new TextDecoder().decode(serializeFfmetadata(document)),
      `;FFMETADATA1\n[CHAPTER]\nTIMEBASE=1/10\n${expected}title=One\n`);
  });
}
