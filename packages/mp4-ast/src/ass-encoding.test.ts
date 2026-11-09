import assert from "node:assert/strict";
import { it } from "node:test";
import { assAst } from "./containers/ass.js";

const script = "[Script Info]\nTitle: 世界\n[Events]\n"
  + "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n"
  + "Dialogue: 0,0:00:01.00,0:00:02.00,Default,,0,0,0,,Café 世界 😀\n";
for (const encoding of ["utf8", "utf8-bom", "utf16le", "utf16be"] as const) {
  it(`detects, parses, probes and copies ${encoding} ASS without losing Unicode`, () => {
    const bytes = encoding === "utf8" ? Buffer.from(script)
      : encoding === "utf8-bom" ? Buffer.from("\uFEFF" + script)
      : Buffer.from("\uFEFF" + script, "utf16le");
    if (encoding === "utf16be") bytes.swap16();
    const plugin = assAst();
    assert.equal(plugin.detect(bytes), true);
    const doc = plugin.parse(bytes);
    assert.equal(doc.byteLength, bytes.byteLength);
    assert.deepEqual(doc.tracks[0]!.samples.map(sample => [
      sample.pts, sample.duration, new TextDecoder().decode(sample.data)
    ]), [[1000, 1000, "Café 世界 😀"]]);
    const probe = plugin.probe(bytes);
    assert.equal(probe.streams[0]!.codec_name, "ass");
    assert.equal(probe.streams[0]!.duration, "2.000000");
    assert.equal(new TextDecoder().decode(plugin.serialize(plugin.parse(bytes, { decodeSubtitles: false }))), script);
  });
}
