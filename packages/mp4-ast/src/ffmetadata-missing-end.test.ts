import assert from "node:assert/strict";
import { it } from "node:test";
import { parseFfmetadata, serializeFfmetadata } from "./index.js";

for (const [name, end, next, expected] of [
  ["lone missing end", "", "", 100],
  ["missing end before another chapter", "", "[CHAPTER]\nTIMEBASE=1/1000\nSTART=300\nEND=600\ntitle=Next\n", 300],
  ["different next time base", "", "[CHAPTER]\nTIMEBASE=1/100\nSTART=30\nEND=60\n", 300],
  ["explicit end", "END=200\n", "", 200]
] as const) {
  it(`preserves or recovers ${name}`, () => {
    const doc = parseFfmetadata(new TextEncoder().encode(
      `;FFMETADATA1\n[CHAPTER]\nTIMEBASE=1/1000\nSTART=100\n${end}title=Intro\n${next}`));
    assert.equal(doc.chapters?.[0]?.endTimeSeconds, expected / 1000);
    assert.equal(doc.chapters?.[0]?.startTimeSeconds, 0.1);
    if (next) assert.equal(doc.chapters?.[1]?.endTimeSeconds, 0.6);
    assert.deepEqual(parseFfmetadata(serializeFfmetadata(doc)).chapters, doc.chapters);
  });
}

it("does not recover an explicitly reversed end", () => {
  assert.throws(() => parseFfmetadata(new TextEncoder().encode(
    ";FFMETADATA1\n[CHAPTER]\nTIMEBASE=1/1000\nSTART=100\nEND=0\n")), { message: "Chapter end time 0 before start 100" });
});
