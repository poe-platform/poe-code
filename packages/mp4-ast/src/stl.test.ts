import assert from "node:assert/strict";
import { it } from "node:test";
import { allMediaAsts, createMediaAstRegistry, stlAst } from "./index.js";

it("registers Spruce STL for explicit input and probes hundredth-second clocks", () => {
  const bytes = new TextEncoder().encode("00:00:00:15,00:00:01:15,First|line\r\n00:00:02:00,00:00:03:15,Second\r\n");
  const registry = createMediaAstRegistry(allMediaAsts());
  const plugin = registry.findByFormatName("stl")!;
  assert.equal(plugin.id, "stl");
  assert.equal(registry.detect(bytes, "clock.stl"), undefined);
  const doc = plugin.parse(bytes);
  assert.equal(doc.durationSeconds, 3.15);
  assert.deepEqual(doc.tracks[0]!.samples.map(sample => [sample.pts, sample.duration, new TextDecoder().decode(sample.data)]), [
    [15, 100, "First\nline"], [200, 115, "Second"]
  ]);
  assert.equal(plugin.probe(bytes).format.format_name, "stl");
  assert.throws(() => plugin.serialize(doc), /output is not supported/);
});

it("ignores comments and malformed Spruce STL cues", () => {
  const bytes = new TextEncoder().encode("$Comment\nwrong,clock,text\n00:00:00:00,00:00:01:00,Hello, world\n");
  const samples = stlAst().parse(bytes).tracks[0]!.samples;
  assert.equal(samples.length, 1);
  assert.equal(new TextDecoder().decode(samples[0]!.data), "Hello, world");
});
