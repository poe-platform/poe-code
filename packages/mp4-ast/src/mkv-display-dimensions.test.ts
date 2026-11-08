import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { parseMp4 } from "./mp4.js";
import { parseMkv, serializeMkv } from "./containers/mkv.js";
import { readVint } from "./containers/ebml.js";

function children(bytes: Uint8Array): Map<number, Uint8Array> {
  const elements = new Map<number, Uint8Array>();
  for (let offset = 0; offset < bytes.length;) {
    const id = readVint(bytes, offset, false)!;
    offset += id.length;
    const size = readVint(bytes, offset, true)!;
    offset += size.length;
    elements.set(id.value, bytes.subarray(offset, offset + size.value));
    offset += size.value;
  }
  return elements;
}

for (const codecName of ["vp9", "h264"]) {
  for (const [sarWidth, sarHeight] of [[2, 1], [4, 3], [1, 2], [1, 1], [undefined, undefined]]) {
    it(`writes ${codecName} display geometry for SAR ${sarWidth}:${sarHeight}`, () => {
      const source = parseMp4(readFileSync(new URL("./fixtures/packet-positions-faststart.mp4", import.meta.url)));
      const track = source.tracks.find(track => track.type === "video")!;
      const doc = { ...source, tracks: [{ ...track, codecDescriptions: [
        { ...track.codecDescriptions[0]!, codecName, sarWidth, sarHeight }
      ] }] };
      const output = serializeMkv(doc);
      let elements = children(output);
      for (const id of [0x18538067, 0x1654ae6b, 0xae, 0xe0]) elements = children(elements.get(id)!);
      const uint = (id: number) => elements.get(id)?.reduce((value, byte) => value * 256 + byte, 0);
      assert.equal(uint(0xb0), track.width);
      assert.equal(uint(0xba), track.height);
      if (sarWidth && sarHeight && sarWidth !== sarHeight) {
        assert.equal(uint(0x54b2) ?? 0, 0); // DisplayUnit: pixels
        assert.equal(uint(0x54b0)! / uint(0x54ba)!, track.width! * sarWidth / (track.height! * sarHeight));
      } else {
        assert.equal(uint(0x54b0), undefined);
        assert.equal(uint(0x54ba), undefined);
      }
      assert.deepEqual(parseMkv(output).tracks[0]!.samples.map(sample => Buffer.from(sample.data)).sort(Buffer.compare), track.samples.map(sample => Buffer.from(sample.data)).sort(Buffer.compare));
    });
  }
}
