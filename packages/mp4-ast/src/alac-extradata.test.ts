import assert from "node:assert/strict";
import { it } from "node:test";
import { concatBytes, makeBox, makeFullBox, parseMp4, scanMp4CodecDescriptions } from "./index.js";

for (const version of [0, 1, 2]) {
  for (const nested of [false, true]) {
    it(`retains the complete ALAC configuration atom for entry version ${version}, wave=${nested}`, async () => {
      const config = makeBox("alac", Uint8Array.from({ length: 28 }, (_, i) => i));
      const body = new Uint8Array(28 + (version === 1 ? 16 : version === 2 ? 36 : 0));
      new DataView(body.buffer).setUint16(8, version);
      const entry = makeBox("alac", concatBytes([body, nested ? makeBox("wave", config) : config]));
      const stsd = makeFullBox("stsd", 0, 0, concatBytes([new Uint8Array([0, 0, 0, 1]), entry]));
      const bytes = makeBox("moov", makeBox("trak", makeBox("mdia", makeBox("minf", makeBox("stbl", stsd)))));
      const codec = parseMp4(bytes, { decodeAudio: false }).tracks[0]!.codecDescriptions[0]!;
      assert.deepEqual(codec.extraData, config);
      const source = { size: bytes.length, async read(offset: number, length: number) { return bytes.subarray(offset, offset + length); } };
      const descriptions = [];
      for await (const description of scanMp4CodecDescriptions(source, { payloadOffset: 48, payloadSize: stsd.length - 8 })) {
        descriptions.push(description);
      }
      assert.equal(descriptions.length, 1);
      const range = descriptions[0]!.extraDataRange!;
      assert.ok(range);
      assert.deepEqual(bytes.subarray(range.offset, range.offset + range.length), config);
    });
  }
}
