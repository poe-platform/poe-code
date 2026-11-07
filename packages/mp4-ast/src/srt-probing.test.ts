import assert from "node:assert/strict";
import { it } from "node:test";
import { createMediaAstRegistry, srtAst } from "./containers/adapters.js";

it("requires numbered SRT for detection while allowing explicit parsing of unnumbered cues", () => {
  const plugin = srtAst();
  const registry = createMediaAstRegistry([plugin]);
  const input = new TextEncoder().encode("00:00:01,000 --> 00:00:03,500\nCafé costs €2\n\n00:00:02,250 --> 00:00:05,000\nSecond line\n\n");
  for (const filename of [undefined, "in.srt", "in.bin"]) {
    assert.equal(registry.detect(input, filename), undefined);
    assert.equal(registry.detect(input, filename, "srt"), plugin);
  }
  assert.deepEqual(plugin.parse(input).tracks[0]!.samples.map(sample => [
    sample.pts, sample.duration, new TextDecoder().decode(sample.data)
  ]), [[1000, 2500, "Café costs €2"], [2250, 2750, "Second line"]]);
});
