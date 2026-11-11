import assert from "node:assert/strict";
import { it } from "node:test";
import { realtextAst } from "./containers/realtext.js";

for (const [begin, end] of [["1", "2"], ["1.25", "2.5"]]) {
  it(`reads seconds-suffixed RealText times ${begin}s to ${end}s`, () => {
    const parse = (suffix: string) => realtextAst().parse(new TextEncoder().encode(
      `<window><time begin="${begin}${suffix}" end="${end}${suffix}"><clear/>Alpha</window>`
    ));
    const plain = parse("");
    const suffixed = parse("s");
    assert.equal(plain.tracks[0]!.samples.length, 1);
    assert.deepEqual(suffixed.tracks, plain.tracks);
    assert.equal(suffixed.duration, plain.duration);
  });
}
