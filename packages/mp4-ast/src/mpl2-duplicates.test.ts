import assert from "node:assert/strict";
import { it } from "node:test";
import { mpl2Ast } from "./index.js";

it("drops consecutive MPL2 duplicate packets after timestamp sorting", () => {
  const bytes = new TextEncoder().encode("[10][20]Alpha\n[10][20]Alpha\n[30][40]Later\n[010][020]Alpha\r\n");
  const plugin = mpl2Ast();
  const doc = plugin.parse(bytes);
  assert.deepEqual(doc.tracks[0]!.samples.map(sample => [sample.pts, sample.duration, new TextDecoder().decode(sample.data)]),
    [[10, 10, "Alpha"], [30, 10, "Later"]]);
  assert.equal(doc.durationSeconds, 4);
  assert.equal(plugin.probe(bytes, { showPackets: true }).packets?.length, 2);
});

it("preserves MPL2 cues with distinct timing or dialogue, including intervening cues", () => {
  const bytes = new TextEncoder().encode("[10][20]Alpha\n[10][20]Other\n[10][20]Alpha\n[10][21]Alpha\n[11][20]Alpha\n");
  const doc = mpl2Ast().parse(bytes);
  assert.deepEqual(doc.tracks[0]!.samples.map(sample => [sample.pts, sample.duration, new TextDecoder().decode(sample.data)]),
    [[10, 10, "Alpha"], [10, 10, "Other"], [10, 10, "Alpha"], [10, 11, "Alpha"], [11, 9, "Alpha"]]);
  assert.equal(doc.durationSeconds, 2.1);
});
