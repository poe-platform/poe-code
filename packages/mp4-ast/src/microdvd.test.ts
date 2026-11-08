import assert from "node:assert/strict";
import { it } from "node:test";
import { allMediaAsts, createMediaAstRegistry, serializeSubtitleDocument } from "./containers/adapters.js";

it("detects MicroDVD and uses its declared frame rate without emitting the header", () => {
  const bytes = new TextEncoder().encode("{1}{1}25.000\n{31}{70}First line|continuation\n{85}{125}Last & final\n");
  const registry = createMediaAstRegistry(allMediaAsts());
  const plugin = registry.detect(bytes, "input.sub");
  assert.equal(plugin?.id, "microdvd");
  const doc = plugin!.parse(bytes);
  assert.deepEqual(doc.tracks[0]!.samples.map(s => [s.pts / doc.tracks[0]!.timescale, s.duration / doc.tracks[0]!.timescale]), [[1.24, 1.56], [3.4, 1.6]]);
  assert.equal(new TextDecoder().decode(plugin!.serialize(doc)), "{31}{70}First line|continuation\n{85}{125}Last & final\n");
  assert.ok(serializeSubtitleDocument(doc, "webvtt").length > 0);
});

for (const rate of [24, 29.97, 50]) {
  it(`honors ${rate} fps with a zero-frame header and CRLF`, () => {
    const plugin = createMediaAstRegistry(allMediaAsts()).findById("microdvd")!;
    const doc = plugin.parse(new TextEncoder().encode(`{0}{0}${rate}\r\n{30}{90}Caption\r\n`));
    assert.equal(doc.tracks[0]!.timescale, rate);
    assert.equal(doc.tracks[0]!.samples.length, 1);
    assert.equal(doc.durationSeconds, 90 / rate);
    assert.equal(new TextDecoder().decode(plugin.serialize(doc)), "{30}{90}Caption\n");
  });
}

it("does not detect unrelated .sub contents or transcode SRT into MicroDVD", () => {
  const registry = createMediaAstRegistry(allMediaAsts());
  assert.equal(registry.detect(new TextEncoder().encode("not subtitles"), "input.sub"), undefined);
  const srt = registry.findById("srt")!.parse(new TextEncoder().encode("1\n00:00:01,000 --> 00:00:02,000\nHello\n"));
  assert.throws(() => registry.findById("microdvd")!.serialize(srt), /stream copy/);
});
