import assert from "node:assert/strict";
import { it } from "node:test";
import { pjsAst } from "./index.js";

for (const [start, end] of [["+10", "+20"], ["-1", "10"], ["-20", "-10"], ["-0", "+0"]]) {
  it(`detects and preserves signed PJS timestamps ${start},${end}`, () => {
    const bytes = new TextEncoder().encode(`${start},${end},"Alpha"\n30,40,"Beta"\n`);
    const plugin = pjsAst();
    assert.equal(plugin.detect(bytes), true);
    const doc = plugin.parse(bytes);
    assert.deepEqual(doc.tracks[0]!.samples.map(sample => [sample.pts, sample.dts, sample.duration, new TextDecoder().decode(sample.data)]),
      [[Number(start), Number(start), Number(end) - Number(start), "Alpha"], [30, 30, 10, "Beta"]]);
    assert.equal(doc.durationSeconds, 4);
    assert.equal(plugin.probe(bytes).streams[0]!.codec_name, "pjs");
  });
}

for (const invalid of ["+", "-", "++1", "--1", "+-1", "1-", "+1.5", "-1e2", "+ 1", "-9007199254740992"]) {
  for (const endpoints of [`${invalid},20`, `-20,${invalid}`]) {
    it(`rejects invalid signed PJS timestamps ${endpoints}`, () => {
      const bytes = new TextEncoder().encode(`${endpoints},"Alpha"\n`);
      const plugin = pjsAst();
      assert.equal(plugin.detect(bytes), false);
      assert.equal(plugin.parse(bytes).tracks[0]!.samples.length, 0);
    });
  }
}
