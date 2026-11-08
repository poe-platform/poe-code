import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { parseMp4, probeMp4, serializeMp4 } from "./mp4.js";
import { probeMp4MetadataSource } from "./mp4-metadata-source.js";

// ffmpeg -f lavfi -i sine=frequency=440:sample_rate=16000:duration=0.05
//   -c:a aac -metadata compilation=1 compilation.m4a
const native = new Uint8Array(readFileSync(new URL("./fixtures/compilation.m4a", import.meta.url)));
it("reads native compilation metadata and preserves explicit zero through repeated copies", async () => {
  const doc = parseMp4(native);
  assert.equal(doc.metadata.compilation, "1");
  for (const compilation of ["0", "1", "", undefined]) {
    const bytes = serializeMp4({ ...doc, metadata: { compilation } });
    const expected = compilation || undefined;
    assert.equal(parseMp4(bytes).metadata.compilation, expected);
    assert.equal(probeMp4(bytes).format.tags?.compilation, expected);
    const source = await probeMp4MetadataSource({ size: bytes.length,
      async read(offset, length) { return bytes.subarray(offset, offset + length); }
    }, 0);
    assert.equal(source.tags.compilation, expected);
    assert.equal(parseMp4(serializeMp4(parseMp4(bytes))).metadata.compilation, expected);
    assert.deepEqual(parseMp4(bytes).tracks[0]!.samples.map(sample => sample.data),
      doc.tracks[0]!.samples.map(sample => sample.data));
  }
});
