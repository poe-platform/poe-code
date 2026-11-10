import assert from "node:assert/strict";
import { it } from "node:test";
import { microdvdAst } from "./containers/microdvd.js";

it("sorts MicroDVD cues by timestamp while preserving tied cue order and frame ranges", () => {
  const plugin = microdvdAst();
  const doc = plugin.parse(new TextEncoder().encode(
    "{1}{1}25\n{75}{100}Late\n{25}{60}Early first\n{25}{50}Early second\n"));
  assert.deepEqual(doc.tracks[0]!.samples.map(sample => [sample.pts, sample.dts, sample.duration]),
    [[25, 25, 35], [25, 25, 25], [75, 75, 25]]);
  assert.equal(doc.durationSeconds, 4);
  assert.equal(new TextDecoder().decode(plugin.serialize(doc)),
    "{25}{60}Early first\n{25}{50}Early second\n{75}{100}Late\n");
});
