import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { parseMkv, serializeMkv } from "./containers/mkv.js";

// Native ffmpeg: testsrc2=s=64x32:r=2:d=1 -c:v libvpx -threads 1 -g 1
// -field_order progressive/tt/bb. Each fixture has two identical VP8 packets.
for (const [name, fieldOrder] of [["normal", "progressive"], ["top", "tt"], ["bottom", "bb"]]) {
  it(`preserves native Matroska ${fieldOrder} and both packet payloads`, () => {
    const bytes = readFileSync(new URL(`./fixtures/vp8-field-${name}.mkv`, import.meta.url));
    const source = parseMkv(new Uint8Array(bytes));
    assert.equal(source.tracks[0]!.codecDescriptions[0]!.fieldOrder, fieldOrder);
    const copied = parseMkv(serializeMkv(source));
    assert.equal(copied.tracks[0]!.codecDescriptions[0]!.fieldOrder, fieldOrder);
    assert.equal(copied.tracks[0]!.samples.length, 2);
    assert.deepEqual(copied.tracks[0]!.samples.map(sample => sample.data),
      source.tracks[0]!.samples.map(sample => sample.data));
  });
}
