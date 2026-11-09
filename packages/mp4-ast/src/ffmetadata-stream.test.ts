import assert from "node:assert/strict";
import { it } from "node:test";
import { ffmetadataAst, parseFfmetadata, serializeFfmetadata } from "./index.js";

it("keeps stream tags out of global FFmetadata on export", () => {
  const document = parseFfmetadata(new TextEncoder().encode(
    ";FFMETADATA1\ntitle=Global\n[STREAM]\ntitle=Track\nartist=Track artist\n"
  ));
  assert.equal(document.metadata.title, "Global");
  assert.equal(document.metadata.artist, undefined);
  assert.equal(new TextDecoder().decode(serializeFfmetadata(document)),
    ";FFMETADATA1\ntitle=Global\n");
});

it("keeps chapters separate from streams before and after them", () => {
  const document = parseFfmetadata(new TextEncoder().encode([
    ";FFMETADATA1", "[STREAM]", "title=First stream",
    "[CHAPTER]", "TIMEBASE=1/1000", "START=0", "END=1000", "title=Chapter",
    "[STREAM]", "title=Second stream", "[STREAM]", "title=Third stream"
  ].join("\n")));
  assert.equal(document.metadata.title, undefined);
  assert.equal(document.chapters?.length, 1);
  assert.equal(document.chapters?.[0]?.title, "Chapter");
  assert.equal(document.chapters?.[0]?.endTimeSeconds, 1);
});

for (const count of [0, 1, 2]) {
  it(`exposes ${count} empty FFmetadata stream sections as data tracks`, () => {
    const bytes = new TextEncoder().encode(";FFMETADATA1\n" + "[STREAM]\n".repeat(count));
    const document = parseFfmetadata(bytes);
    assert.deepEqual(document.tracks.map(track => track.type), Array(count).fill("data"));
    const probe = ffmetadataAst().probe!(bytes, {});
    assert.deepEqual(probe.streams.map(({ index, codec_type }) => ({ index, codec_type })),
      Array.from({ length: count }, (_, index) => ({ index, codec_type: "data" })));
    assert.equal(probe.format.nb_streams, count);
    assert.ok(probe.streams.every(stream => stream.codec_name === undefined));
  });
}
