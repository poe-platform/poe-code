import assert from "node:assert/strict";
import { it } from "node:test";
import { parseFfmetadata, serializeFfmetadata } from "./index.js";

for (const denominator of [0, -1000, 1000]) {
  it(`handles FFmetadata chapter time base 1/${denominator}`, () => {
    const input = new TextEncoder().encode(`;FFMETADATA1\n[CHAPTER]\nTIMEBASE=1/${denominator}\nSTART=100\nEND=500\n`);
    if (denominator <= 0) {
      assert.throws(() => parseFfmetadata(input), {
        message: "FFmetadata chapter TIMEBASE denominator must be positive"
      });
    } else {
      const document = parseFfmetadata(input);
      const chapter = document.chapters![0]!;
      assert.deepEqual(chapter.timeBase, { numerator: 1, denominator: 1000 });
      assert.equal(chapter.startTimeSeconds, 0.1);
      assert.equal(chapter.endTimeSeconds, 0.5);
      assert.ok(new TextDecoder().decode(serializeFfmetadata(document)).includes("TIMEBASE=1/1000\nSTART=100\nEND=500\n"));
    }
  });
}
