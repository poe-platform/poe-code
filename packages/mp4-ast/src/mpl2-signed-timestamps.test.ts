import assert from "node:assert/strict";
import { it } from "node:test";
import { mpl2Ast } from "./index.js";

for (const [input, expected] of [
  ["[+10][+20]Alpha\n", [[10, 10, "Alpha"]]],
  ["[-1][20]Alpha\n[30][40]Beta\n", [[-1, 21, "Alpha"], [30, 10, "Beta"]]],
  ["[-20][-10]Alpha\n[+30][40]Beta\n", [[-20, 10, "Alpha"], [30, 10, "Beta"]]]
] as const) {
  it(`detects signed MPL2 and retains packet timestamps for ${JSON.stringify(input)}`, () => {
    const bytes = new TextEncoder().encode(input);
    const plugin = mpl2Ast();
    assert.equal(plugin.detect(bytes), true);
    const doc = plugin.parse(bytes);
    assert.equal(doc.tracks[0]!.timescale, 10);
    assert.deepEqual(doc.tracks[0]!.samples.map(sample =>
      [sample.pts, sample.duration, new TextDecoder().decode(sample.data)]), expected);
    assert.equal(plugin.probe(bytes).streams[0]!.start_time, (expected[0][0] / 10).toFixed(6));
  });
}

it("rejects malformed and unsafe signed MPL2 timestamps", () => {
  const plugin = mpl2Ast();
  for (const timing of ["[+][20]", "[-][20]", "[1][+]", "[1][-]", "[++1][20]",
    "[+-1][20]", "[-1e2][20]", "[-1.5][20]", "[-9007199254740992][20]"]) {
    const bytes = new TextEncoder().encode(`${timing}Invalid\n`);
    assert.equal(plugin.detect(bytes), false, timing);
    assert.deepEqual(plugin.parse(bytes).tracks[0]!.samples, [], timing);
  }
});
