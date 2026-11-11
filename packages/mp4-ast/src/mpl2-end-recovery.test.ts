import assert from "node:assert/strict";
import { it } from "node:test";
import { mpl2Ast } from "./index.js";

for (const [name, input, expected] of [
  ["missing end", "[10][]Alpha\n[30][40]Beta\n", [[10, 20, "Alpha"], [30, 10, "Beta"]]],
  ["earlier end", "[20][10]Alpha\n[30][40]Beta\n", [[20, 10, "Alpha"], [30, 10, "Beta"]]],
  ["explicit end", "[10][30]Alpha\n[30][40]Beta\n", [[10, 20, "Alpha"], [30, 10, "Beta"]]],
  ["chronological recovery", "[30][40]Beta\n[10][]Alpha\n", [[10, 20, "Alpha"], [30, 10, "Beta"]]],
  ["consecutive recovery", "[10][]Alpha\ninvalid\n[20][10]Middle\n[30][40]Beta\n", [[10, 10, "Alpha"], [20, 10, "Middle"], [30, 10, "Beta"]]],
  ["equal start", "[10][]Alpha\n[10][40]Beta\n", [[10, 0, "Alpha"], [10, 30, "Beta"]]],
  ["recovery before deduplication", "[10][]Alpha\n[10][]Alpha\n[30][40]Beta\n", [[10, 0, "Alpha"], [10, 20, "Alpha"], [30, 10, "Beta"]]],
  ["explicit zero duration", "[10][10]Alpha\n[30][40]Beta\n", [[10, 0, "Alpha"], [30, 10, "Beta"]]],
  ["overlapping explicit end", "[10][50]Alpha\n[30][40]Beta\n", [[10, 40, "Alpha"], [30, 10, "Beta"]]]
] as const) {
  it(`recovers MPL2 ${name} timing without changing explicit intervals`, () => {
    const bytes = new TextEncoder().encode(input);
    const plugin = mpl2Ast();
    assert.equal(plugin.detect(bytes), true);
    const doc = plugin.parse(bytes);
    assert.deepEqual(doc.tracks[0]!.samples.map(sample =>
      [sample.pts, sample.duration, new TextDecoder().decode(sample.data)]), expected);
    const end = Math.max(...expected.map(([start, duration]) => start + duration));
    assert.equal(doc.duration, end);
    assert.equal(doc.tracks[0]!.duration, end);
    assert.equal(doc.durationSeconds, end / 10);
  });
}

for (const timing of ["[10][]", "[20][10]"]) {
  it(`retains unknown duration at EOF for ${timing}`, () => {
    const doc = mpl2Ast().parse(new TextEncoder().encode(`${timing}Last\n`));
    assert.equal(doc.tracks[0]!.samples.length, 1);
    assert.equal(doc.tracks[0]!.samples[0]!.duration, -1);
  });
}
