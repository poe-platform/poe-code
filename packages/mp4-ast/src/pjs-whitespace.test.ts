import assert from "node:assert/strict";
import { it } from "node:test";
import { pjsAst } from "./index.js";

for (const [timing, accepted] of [
  ["10 ,20", false],
  ["10, 20", true],
  ["10,20 ", true],
  [" 10,20", true]
] as const) {
  it(`handles PJS timing whitespace in ${JSON.stringify(timing)}`, () => {
    const bytes = new TextEncoder().encode(`${timing},"Alpha"\n30,40,"Beta"\n`);
    const plugin = pjsAst();
    const doc = plugin.parse(bytes);
    assert.deepEqual(doc.tracks[0]!.samples.map(sample => [sample.pts, sample.duration, new TextDecoder().decode(sample.data)]),
      accepted ? [[10, 10, "Alpha"], [30, 10, "Beta"]] : [[30, 10, "Beta"]]);
    assert.equal(doc.durationSeconds, 4);
    assert.equal(plugin.detect(bytes), accepted);
  });
}
