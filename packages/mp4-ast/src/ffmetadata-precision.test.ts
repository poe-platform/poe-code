import assert from "node:assert/strict";
import { it } from "node:test";
import { parseFfmetadata, serializeFfmetadata } from "./index.js";

for (const timescale of [undefined, 8000, 44100]) {
  it(`exports chapter ticks using timescale ${timescale ?? "default"}`, () => {
    const denominator = timescale ?? 1000;
    const doc = parseFfmetadata(new TextEncoder().encode(";FFMETADATA1\n"));
    const chapters = [{
      id: 1, ...(timescale === undefined ? {} : { timescale }),
      startTimeSeconds: 1 / denominator, endTimeSeconds: 3 / denominator, title: "cue"
    }];
    assert.equal(new TextDecoder().decode(serializeFfmetadata({ ...doc, chapters })),
      `;FFMETADATA1\n[CHAPTER]\nTIMEBASE=1/${denominator}\nSTART=1\nEND=3\ntitle=cue\n`);
  });
}

it("exports edited chapter boundaries using the source time base", () => {
  const doc = parseFfmetadata(new TextEncoder().encode(
    ";FFMETADATA1\n[CHAPTER]\nTIMEBASE=1/48000\nSTART=1\nEND=49\ntitle=beat\n"
  ));
  const edited = { ...doc, chapters: doc.chapters!.map(chapter => ({
    ...chapter, timescale: 1000, startTimeSeconds: 2 / 48000, endTimeSeconds: 50 / 48000
  })) };
  assert.equal(new TextDecoder().decode(serializeFfmetadata(edited)),
    ";FFMETADATA1\n[CHAPTER]\nTIMEBASE=1/48000\nSTART=2\nEND=50\ntitle=beat\n");
});
