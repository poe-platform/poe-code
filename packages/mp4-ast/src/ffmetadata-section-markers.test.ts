import assert from "node:assert/strict";
import { it } from "node:test";
import { parseFfmetadata } from "./index.js";

for (const [marker, recognized] of [
  ["[CHAPTER]", true],
  ["[CHAPTER] suffix", true],
  ["[CHAPTER]title=ignored", true],
  [" [CHAPTER]", false],
  ["\t[CHAPTER]", false],
  ["[chapter]", false]
] as const) {
  it(`recognizes chapter markers at the raw line start: ${JSON.stringify(marker)}`, () => {
    const input = `;FFMETADATA1\n${marker}\nTIMEBASE=1/10\nSTART=10\nEND=20\ntitle=One\n`;
    const doc = parseFfmetadata(new TextEncoder().encode(input));
    if (recognized) {
      assert.equal(doc.metadata.title, undefined);
      assert.deepEqual(doc.chapters, [{
        id: 0,
        timeBase: { numerator: 1, denominator: 10 },
        startTimeSeconds: 1,
        endTimeSeconds: 2,
        title: "One",
        tags: { title: "One" }
      }]);
    } else {
      assert.equal(doc.chapters, undefined);
      assert.equal(doc.metadata.title, "One");
      assert.deepEqual(doc.metadata.custom, { TIMEBASE: "1/10", START: "10", END: "20" });
    }
  });
}

for (const [marker, recognized] of [
  ["[STREAM]", true],
  ["[STREAM] suffix", true],
  ["[STREAM]foo=ignored", true],
  [" [STREAM]", false],
  ["\t[STREAM]", false],
  ["[stream]", false]
] as const) {
  it(`recognizes stream markers at the raw line start: ${JSON.stringify(marker)}`, () => {
    const input = `;FFMETADATA1\n${marker}\nfoo=1\n`;
    const doc = parseFfmetadata(new TextEncoder().encode(input));
    assert.equal(doc.tracks.length, recognized ? 1 : 0);
    assert.deepEqual(doc.metadata.custom, recognized ? undefined : { foo: "1" });
  });
}
