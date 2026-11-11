import assert from "node:assert/strict";
import { it } from "node:test";
import { microdvdAst } from "./containers/microdvd.js";

for (const separator of ["\r", "\n", "\r\n"]) {
  for (const trailing of [false, true]) {
    it(`reads MicroDVD records separated by ${JSON.stringify(separator)} with trailing separator ${trailing}`, () => {
      const bytes = new TextEncoder().encode(["{1}{1}25", "{25}{50}One", "{50}{75}Two"].join(separator)
        + (trailing ? separator : ""));
      const plugin = microdvdAst();
      assert.equal(plugin.detect(bytes), true);
      const doc = plugin.parse(bytes);
      assert.equal(doc.timescale, 25);
      assert.equal(doc.durationSeconds, 3);
      assert.deepEqual(doc.tracks[0]!.samples.map(sample => [sample.pts, sample.duration, new TextDecoder().decode(sample.data)]),
        [[25, 25, "One"], [50, 25, "Two"]]);
      assert.equal(new TextDecoder().decode(plugin.serialize(doc)), "{25}{50}One\n{50}{75}Two\n");
    });
  }
}
