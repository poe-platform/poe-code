import assert from "node:assert/strict";
import { it } from "node:test";
import { allMediaAsts, createMediaAstRegistry, pjsAst } from "./index.js";

it("detects PJS content and reads quoted decisecond cues including commas and CRLF", () => {
  const bytes = new TextEncoder().encode('12,28,"First, line"\r\n34,50,"Last & final"\r\n');
  const plugin = createMediaAstRegistry(allMediaAsts()).detect(bytes)!;
  assert.equal(plugin.id, "pjs");
  const doc = plugin.parse(bytes);
  assert.equal(doc.durationSeconds, 5);
  assert.equal(doc.tracks[0]!.timescale, 10);
  assert.deepEqual(doc.tracks[0]!.samples.map(sample => [sample.pts, sample.duration, new TextDecoder().decode(sample.data)]),
    [[12, 16, "First, line"], [34, 16, "Last & final"]]);
  assert.equal(plugin.probe(bytes).streams[0]!.codec_name, "pjs");
});

it("sorts PJS cues by timestamp while preserving equal-timestamp order and duration", () => {
  const doc = pjsAst().parse(new TextEncoder().encode('30,40,"Beta"\n10,50,"Alpha"\n10,20,"Same start"\n'));
  assert.deepEqual(doc.tracks[0]!.samples.map(sample =>
    [sample.pts, sample.dts, sample.duration, new TextDecoder().decode(sample.data)]),
  [[10, 10, 40, "Alpha"], [10, 10, 10, "Same start"], [30, 30, 10, "Beta"]]);
  assert.equal(doc.durationSeconds, 5);
  assert.equal(doc.tracks[0]!.duration, 50);
});

it("ignores malformed PJS cues and does not claim unrelated text or offer output", () => {
  const plugin = pjsAst();
  for (const line of ['1,2,unquoted', '1,2,"unclosed', ',2,"empty"', '3,2,"reversed"', '1e2,200,"invalid"', '9007199254740992,9007199254740993,"overflow"']) {
    const bytes = new TextEncoder().encode(line);
    assert.equal(plugin.detect(bytes), false, line);
    assert.deepEqual(plugin.parse(bytes).tracks[0]!.samples, [], line);
  }
  assert.equal(plugin.canMux, false);
  assert.throws(() => plugin.serialize(plugin.parse(new Uint8Array())), /output is not supported/);
});
