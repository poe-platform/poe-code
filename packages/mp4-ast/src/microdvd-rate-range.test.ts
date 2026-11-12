import assert from "node:assert/strict";
import { it } from "node:test";
import { microdvdAst } from "./containers/microdvd.js";

for (const rate of [3, 100, 2, 101]) {
  it(`preserves ${rate} as dialogue outside the frame-rate range`, () => {
    const plugin = microdvdAst();
    const input = `{1}{1}${rate}\n{25}{50}First\n{75}{100}Last\n`;
    const doc = plugin.parse(new TextEncoder().encode(input));
    assert.equal(doc.timescale, 24000 / 1001);
    assert.equal(new TextDecoder().decode(plugin.serialize(doc)), input);
  });
}

for (const rate of [3.001, 4, 60, 99.999]) {
  it(`accepts ${rate} inside the frame-rate range`, () => {
    const doc = microdvdAst().parse(new TextEncoder().encode(`{1}{1}${rate}\n{25}{50}First\n`));
    assert.equal(doc.timescale, rate);
    assert.equal(doc.tracks[0]!.samples.length, 1);
  });
}
