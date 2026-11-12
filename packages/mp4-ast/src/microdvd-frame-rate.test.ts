import assert from "node:assert/strict";
import { it } from "node:test";
import { microdvdAst } from "./containers/microdvd.js";

for (const [start, end] of [[0, 0], [0, 1], [1, 0], [1, 1]]) {
  for (const header of ["25", "25 fps", "25.000 fps", " 25 fps", "2.5e1 fps"]) {
    it(`reads the numeric frame rate from {${start}}{${end}}${header}`, () => {
      const plugin = microdvdAst();
      const doc = plugin.parse(new TextEncoder().encode(`{${start}}{${end}}${header}\r\n{25}{50}Hello\r\n`));
      assert.equal(doc.timescale, 25);
      assert.equal(doc.tracks[0]!.timescale, 25);
      assert.equal(doc.durationSeconds, 2);
      assert.deepEqual(doc.tracks[0]!.samples.map(sample => [
        sample.pts, sample.duration, new TextDecoder().decode(sample.data)
      ]), [[25, 25, "Hello"]]);
      assert.equal(new TextDecoder().decode(plugin.serialize(doc)), "{25}{50}Hello\n");
    });
  }
}

for (const header of ["fps", "0 fps", "-25 fps", "Infinity fps", "1e999 fps"]) {
  it(`preserves an invalid frame-rate header as a caption: ${header}`, () => {
    const plugin = microdvdAst();
    const input = `{1}{1}${header}\n{25}{50}Hello\n`;
    const doc = plugin.parse(new TextEncoder().encode(input));
    assert.equal(doc.timescale, 24000 / 1001);
    assert.equal(doc.tracks[0]!.samples.length, 2);
    assert.equal(new TextDecoder().decode(plugin.serialize(doc)), input);
  });
}

it("preserves numeric text after the first three records", () => {
  const plugin = microdvdAst();
  const input = "{0}{0}Intro\n{0}{1}Next\n{1}{2}25 fps\n{1}{1}50 fps\n{25}{50}Hello\n";
  const doc = plugin.parse(new TextEncoder().encode(input));
  assert.equal(doc.timescale, 24000 / 1001);
  assert.equal(new TextDecoder().decode(plugin.serialize(doc)), input);
});
