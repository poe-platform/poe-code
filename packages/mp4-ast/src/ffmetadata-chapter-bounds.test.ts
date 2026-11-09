import assert from "node:assert/strict";
import { it } from "node:test";
import { parseFfmetadata } from "./index.js";

for (const suffix of ["", "\n[CHAPTER]\nSTART=0\nEND=0", "\n[STREAM]\ntitle=Audio"]) {
  it(`rejects reversed chapter bounds before ${JSON.stringify(suffix)}`, () => {
    const input = `;FFMETADATA1\n[CHAPTER]\nTIMEBASE=1/1000\nSTART=500\nEND=100${suffix}`;
    assert.throws(() => parseFfmetadata(new TextEncoder().encode(input)), {
      message: "Chapter end time 100 before start 500"
    });
  });
}

for (const end of [100, 500]) {
  it(`accepts chapter start 100 and end ${end}`, () => {
    const input = `;FFMETADATA1\n[CHAPTER]\nTIMEBASE=1/1000\nSTART=100\nEND=${end}`;
    const chapter = parseFfmetadata(new TextEncoder().encode(input)).chapters![0]!;
    assert.equal(chapter.startTimeSeconds, 0.1);
    assert.equal(chapter.endTimeSeconds, end / 1000);
  });
}
