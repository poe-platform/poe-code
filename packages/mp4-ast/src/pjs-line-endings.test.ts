import assert from "node:assert/strict";
import { it } from "node:test";
import { pjsAst } from "./index.js";

for (const ending of ["\r", "\n", "\r\n"]) {
  it(`reads separate PJS records delimited by ${JSON.stringify(ending)}`, () => {
    const bytes = new TextEncoder().encode(['10,20,"Alpha"', '30,40,"Beta"', ""].join(ending));
    const plugin = pjsAst();
    assert.equal(plugin.detect(bytes), true);
    const doc = plugin.parse(bytes);
    assert.deepEqual(doc.tracks[0]!.samples.map(sample =>
      [sample.pts, sample.duration, new TextDecoder().decode(sample.data)]),
    [[10, 10, "Alpha"], [30, 10, "Beta"]]);
    assert.equal(doc.durationSeconds, 4);
  });

  it(`detects the first PJS record before ${JSON.stringify(ending)}`, () => {
    assert.equal(pjsAst().detect(new TextEncoder().encode('10,20,"Alpha"' + ending + "invalid")), true);
  });
}
