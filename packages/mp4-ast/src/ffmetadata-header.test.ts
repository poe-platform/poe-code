import assert from "node:assert/strict";
import { it } from "node:test";
import { parseFfmetadata, serializeFfmetadata } from "./index.js";

for (const [body, start, end, tags] of [
  ["START=100\nEND=500\ntitle=Intro", 100, 500, { title: "Intro" }],
  ["START=100\nEND=500\nEND=300", 100, 500, { END: "300" }],
  ["END=500\nSTART=100", 0, 500, { START: "100" }],
  ["title=early\nSTART=100\nEND=500", 0, 0, { START: "100", END: "500" }],
  ["start=100\nend=500", 0, 0, { end: "500" }],
  ["START=100\nEND=500\nTIMEBASE=1/10", 100, 500, { TIMEBASE: "1/10" }]
] as const) {
  it(`reads positional chapter timing: ${body}`, () => {
    const doc = parseFfmetadata(new TextEncoder().encode(`;FFMETADATA1\n[CHAPTER]\nTIMEBASE=1/1000\n${body}\n`));
    const chapter = doc.chapters![0]!;
    assert.equal(chapter.startTimeSeconds, start / 1000);
    assert.equal(chapter.endTimeSeconds, end / 1000);
    assert.deepEqual(chapter.tags, tags);
    assert.deepEqual(parseFfmetadata(serializeFfmetadata(doc)).chapters, doc.chapters);
  });
}
