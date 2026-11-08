import assert from "node:assert/strict";
import { it } from "node:test";
import { createSyntheticMp4, parseMp4, probeMp4, probeMp4Source, serializeMp4 } from "./index.js";

for (const fragmented of [false, true]) {
  it(`preserves explicit zero track IDs in both readers (fragmented=${fragmented})`, async () => {
    const doc = parseMp4(createSyntheticMp4({ width: 16, height: 16, frameCount: 2 }));
    const bytes = serializeMp4({ ...doc, tracks: [{ ...doc.tracks[0]!, id: 0 }] }, { fragmented });
    assert.equal(parseMp4(bytes).tracks[0]!.id, 0);
    const source = await probeMp4Source({ size: bytes.length, async read(offset, length) {
      return bytes.subarray(offset, offset + length);
    } }, { syncSamples() {
      const keys = new Set<number>();
      return { add(n: number) { keys.add(n); }, has(n: number) { return keys.has(n); } };
    } });
    for (const probe of [probeMp4(bytes), source]) {
      const streams = [];
      for await (const stream of probe.streams ?? []) streams.push(stream);
      assert.equal(streams[0]!.id, "0x0");
    }
  });
}
