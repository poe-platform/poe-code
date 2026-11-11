import assert from "node:assert/strict";
import { it } from "node:test";
import { allMediaAsts, createMediaAstRegistry, mpl2Ast } from "./index.js";

for (const endings of [["\r", "\r"], ["\r\n", "\r\n"], ["\n", "\n"], ["\r", "\n"], ["\r", ""]]) {
  it(`reads separate MPL2 records with ${JSON.stringify(endings)} endings`, () => {
    const bytes = new TextEncoder().encode(`[10][20]Alpha${endings[0]}[30][40]Beta${endings[1]}`);
    const plugin = mpl2Ast();
    assert.equal(plugin.detect(bytes), true);
    const doc = plugin.parse(bytes);
    assert.equal(doc.durationSeconds, 4);
    assert.deepEqual(doc.tracks[0]!.samples.map(sample => [sample.pts, sample.duration, new TextDecoder().decode(sample.data)]),
      [[10, 10, "Alpha"], [30, 10, "Beta"]]);
  });
}

for (const [timing, accepted] of [
  ["[10][20]", true],
  ["[ 10][ 20]", true],
  ["[\t10][20]", true],
  ["[10][\t 20]", true],
  ["[\v\f 10][\f\v20]", true],
  ["[10 ][20]", false],
  ["[10][20 ]", false],
  ["[ 10 ][ 20 ]", false],
  ["[ ][20]", false],
  ["[10][\t]", false],
  ["[1 0][20]", false],
  ["[\u00a010][20]", false],
  ["[10][\u200320]", false]
] as const) {
  it(`accepts only leading ASCII whitespace in MPL2 numeric fields: ${JSON.stringify(timing)}`, () => {
    const bytes = new TextEncoder().encode(`${timing}Alpha\n[30][40]Beta\n`);
    const plugin = mpl2Ast();
    assert.equal(plugin.detect(bytes), accepted);
    assert.deepEqual(plugin.parse(bytes).tracks[0]!.samples.map(sample =>
      [sample.pts, sample.duration, new TextDecoder().decode(sample.data)]),
    accepted ? [[10, 10, "Alpha"], [30, 10, "Beta"]] : [[30, 10, "Beta"]]);
  });
}

it("reads MPL2 decisecond packets with CRLF and ignores malformed timing", () => {
  const bytes = new TextEncoder().encode("[12][28]First|second\r\n[34][50]Last\r\n[5][4]Reversed\n[][8]Empty\n[1e2][200]Invalid\n[9007199254740992][9007199254740993]Overflow\n");
  const plugin = createMediaAstRegistry(allMediaAsts()).findById("mpl2")!;
  const doc = plugin.parse(bytes);
  assert.equal(doc.durationSeconds, 5);
  assert.equal(doc.tracks[0]!.timescale, 10);
  assert.deepEqual(doc.tracks[0]!.samples.map(sample => [sample.pts, sample.duration, new TextDecoder().decode(sample.data)]),
    [[12, 16, "First|second"], [34, 16, "Last"]]);
  assert.equal(plugin.probe(bytes).streams[0]!.codec_name, "mpl2");
});

it("does not claim unrelated text or offer MPL2 output", () => {
  const plugin = mpl2Ast();
  assert.equal(plugin.detect(new TextEncoder().encode("[metadata]\nUnrelated text")), false);
  assert.equal(plugin.canMux, false);
  assert.throws(() => plugin.serialize(plugin.parse(new Uint8Array())), /output is not supported/);
});

it("orders MPL2 packets by start time while preserving equal-time input order", () => {
  const bytes = new TextEncoder().encode("[30][40]Beta\n[10][50]Alpha\n[10][20]Together\n");
  const doc = mpl2Ast().parse(bytes);
  const track = doc.tracks[0]!;
  assert.deepEqual(track.samples.map(sample =>
    [sample.pts, sample.dts, sample.duration, new TextDecoder().decode(sample.data)]),
  [[10, 10, 40, "Alpha"], [10, 10, 10, "Together"], [30, 30, 10, "Beta"]]);
  assert.equal(track.duration, 50);
  assert.equal(doc.durationSeconds, 5);
});
