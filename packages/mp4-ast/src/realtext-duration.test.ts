import assert from "node:assert/strict";
import { it } from "node:test";
import { realtextAst } from "./containers/realtext.js";

for (const [window, duration] of [["", 60000], [' duration="3"', 3000], [' duration="0:01.25"', 1250]] as const) {
  for (const end of ["", ' end="1"', ' end="0"', ' end="2"']) {
    it(`uses window ${window || "default"} duration unless end ${end || "missing"} is later`, () => {
      const doc = realtextAst().parse(new TextEncoder().encode(
        `<window${window}><time begin="1"${end}><clear/>Alpha</window>`
      ));
      const expectedDuration = end === ' end="2"' ? 1000 : duration;
      assert.deepEqual(doc.tracks[0]!.samples.map(sample => ({
        pts: sample.pts, duration: sample.duration, text: new TextDecoder().decode(sample.data)
      })), [{ pts: 1000, duration: expectedDuration, text: "Alpha" }]);
      assert.equal(doc.duration, 1000 + expectedDuration);
      assert.equal(doc.tracks[0]!.duration, doc.duration);
    });
  }
}
