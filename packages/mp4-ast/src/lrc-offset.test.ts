import assert from "node:assert/strict";
import { it } from "node:test";
import { lrcAst } from "./containers/lrc.js";

for (const offset of ["500", "+500", "-500", "0"]) {
  it(`subtracts LRC offset ${offset} in milliseconds`, () => {
    const doc = lrcAst().parse(new TextEncoder().encode(`[offset:${offset}]\n[00:01.00]one\n[00:05.00]end\n`));
    assert.deepEqual(doc.tracks[0]!.samples.map(s => [s.pts, s.dts]),
      [[1000 - Number(offset), 1000 - Number(offset)], [5000 - Number(offset), 5000 - Number(offset)]]);
  });
}

it("applies changed offsets only to following cues before sorting and inferring ends", () => {
  const doc = lrcAst().parse(new TextEncoder().encode("[00:01.00]one\r\n[offset:-5000]\r\n[00:02.00]two\r\n[offset:0]\r\n[00:05.00]end\r\n"));
  assert.deepEqual(doc.tracks[0]!.samples.map(s => [s.pts, new TextDecoder().decode(s.data)]),
    [[1000, "one"], [5000, "end"], [7000, "two"]]);
  assert.deepEqual(doc.tracks[0]!.samples.slice(0, 2).map(s => s.duration), [4000, 2000]);
});
