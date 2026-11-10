import assert from "node:assert/strict";
import { it } from "node:test";
import { microdvdAst } from "./containers/microdvd.js";

it("drops consecutive identical packets before stream copy", () => {
  const plugin = microdvdAst();
  const bytes = new TextEncoder().encode("{1}{1}25\n{25}{50}Same\n{25}{50}Same\n{25}{50}Same\n{25}{50}Other\n{25}{50}Same\n{75}{100}Same\n");
  const doc = plugin.parse(bytes);
  assert.deepEqual(doc.tracks[0]!.samples.map(sample => [
    sample.pts, sample.duration, new TextDecoder().decode(sample.data)
  ]), [[25, 25, "Same"], [25, 25, "Other"], [25, 25, "Same"], [75, 25, "Same"]]);
  assert.equal(doc.durationSeconds, 4);
  assert.equal(new TextDecoder().decode(plugin.serialize(doc)), "{25}{50}Same\n{25}{50}Other\n{25}{50}Same\n{75}{100}Same\n");
});
