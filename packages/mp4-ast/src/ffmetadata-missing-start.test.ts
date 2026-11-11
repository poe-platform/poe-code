import assert from "node:assert/strict";
import { it } from "node:test";
import { parseFfmetadata, serializeFfmetadata } from "./index.js";

for (const denominator of [1, 10]) {
  for (const explicit of [false, true]) {
    it(`recovers missing chapter starts in ticks (denominator=${denominator}, explicit=${explicit})`, () => {
      const prefix = ";FFMETADATA1\n[CHAPTER]\nTIMEBASE=1/1\nSTART=1\nEND=2\ntitle=A\n";
      const chapter = `[CHAPTER]\nTIMEBASE=1/${denominator}\n`;
      const end = `END=${8 * denominator}\ntitle=B\n`;
      const doc = parseFfmetadata(new TextEncoder().encode(`${prefix}${chapter}${explicit ? "START=4\n" : ""}${end}`));
      assert.equal(new TextDecoder().decode(serializeFfmetadata(doc)), `${prefix}${chapter}START=${explicit ? 4 : 2}\n${end}`);
      assert.deepEqual(doc.demuxErrors ?? [], explicit ? [] : [`[ffmetadata] Expected chapter start timestamp, found END=${8 * denominator}.`]);
    });
  }
}
