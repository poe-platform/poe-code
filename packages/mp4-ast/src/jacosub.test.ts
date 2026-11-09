import assert from "node:assert/strict";
import { it } from "node:test";
import { allMediaAsts, createMediaAstRegistry } from "./containers/adapters.js";

it("detects JACOsub by content and honors tick rates and shifts", () => {
  const registry = createMediaAstRegistry(allMediaAsts());
  for (const rate of [30, 60]) {
    const bytes = new TextEncoder().encode(`#T ${rate}\r\n#S 0:00:00.00\r\n@15 @45 JL First\\nline\r\n@60 @105 JL Second\r\n`);
    const plugin = registry.detect(bytes, "unknown.txt");
    assert.equal(plugin?.id, "jacosub");
    const doc = plugin!.parse(bytes);
    assert.deepEqual(doc.tracks[0]!.samples.map(s => [s.pts, s.pts + s.duration]),
      rate === 30 ? [[500, 1500], [2000, 3500]] : [[250, 750], [1000, 1750]]);
    assert.equal(doc.durationSeconds, 105 / rate);
    assert.equal(new TextDecoder().decode(doc.tracks[0]!.samples[0]!.data), "JL First\\nline");
    assert.throws(() => plugin!.serialize(doc), /not supported/);
  }
  const plugin = registry.findById("jacosub")!;
  const shifted = plugin.parse(new TextEncoder().encode("#TIMERES 60\n#SHIFT -0:00:00.15\n0:00:01.00 0:00:02.00 JR Right\n"));
  assert.equal(shifted.tracks[0]!.samples[0]!.pts, 750);
  assert.equal(shifted.tracks[0]!.samples[0]!.duration, 1000);
  assert.equal(plugin.detect(new TextEncoder().encode("not subtitles")), false);
  assert.throws(() => plugin.parse(new TextEncoder().encode("#T 0\n@15 @45 JL Text\n")), /tick rate/);
});
