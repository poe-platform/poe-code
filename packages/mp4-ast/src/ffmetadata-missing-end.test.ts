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

// Expected end ticks from native FFmpeg's chapter table, in source order.
for (const [name, rows, ends] of [
  ["out-of-order starts", [[10, 1], [10, 12, 15], [10, 6, 9]], [6, 15, 9]],
  ["last record starts earlier", [[10, 8, 20], [10, 1]], [20, 8]],
  ["equal starts", [[10, 5], [10, 5, 9]], [9, 9]],
  ["chronological control", [[10, 1], [10, 6, 9], [10, 12, 15]], [6, 9, 15]],
  ["two chapter control", [[10, 1], [10, 8, 10]], [8, 10]],
  ["equal starts before later start", [[10, 5], [10, 5, 9], [10, 8, 10]], [10, 9, 10]],
  ["mixed time bases", [[10, 1], [100, 120, 150], [100, 60, 90]], [6, 150, 90]],
  ["consecutive missing ends", [[10, 12, 15], [10, 1], [10, 6]], [15, 6, 12]]
] as const) {
  it(`infers chronological chapter boundaries: ${name}`, () => {
    const input = ";FFMETADATA1\n" + rows.map(([den, start, end]) =>
      `[CHAPTER]\nTIMEBASE=1/${den}\nSTART=${start}\n${end === undefined ? "title=discarded\n" : `END=${end}\n`}`).join("");
    const doc = parseFfmetadata(new TextEncoder().encode(input));
    assert.equal(new TextDecoder().decode(serializeFfmetadata(doc)), ";FFMETADATA1\n" +
      rows.map(([den, start], index) => `[CHAPTER]\nTIMEBASE=1/${den}\nSTART=${start}\nEND=${ends[index]}\n`).join(""));
  });
}
