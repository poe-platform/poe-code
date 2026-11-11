import assert from "node:assert/strict";
import { it } from "node:test";
import { parseFfmetadata, serializeFfmetadata } from "./index.js";

for (const timebase of ["oops", "/1000", ""]) {
  it(`recovers a nonnumeric TIMEBASE=${timebase} as a malformed chapter header`, () => {
    const document = parseFfmetadata(new TextEncoder().encode(
      `;FFMETADATA1\n[CHAPTER]\nTIMEBASE=${timebase}\nSTART=10\nEND=20\ntitle=One\n`));
    assert.deepEqual(document.demuxErrors, [
      `[ffmetadata] Expected chapter start timestamp, found TIMEBASE=${timebase}.`,
      `[ffmetadata] Expected chapter end timestamp, found TIMEBASE=${timebase}.`
    ]);
    assert.equal(new TextDecoder().decode(serializeFfmetadata(document)),
      ";FFMETADATA1\n[CHAPTER]\nTIMEBASE=1/1000000000\nSTART=0\nEND=0\nSTART=10\nEND=20\ntitle=One\n");
  });
}
