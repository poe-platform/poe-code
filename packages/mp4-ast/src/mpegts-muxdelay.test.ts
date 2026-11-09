import assert from "node:assert/strict";
import { it } from "node:test";
import { createSyntheticMp4, parseMp4, serializeMpegTs } from "./index.js";

function timestamp(bytes: Uint8Array, offset: number): number {
  return (bytes[offset]! & 14) * 536870912 + bytes[offset + 1]! * 4194304 +
    (bytes[offset + 2]! & 254) * 16384 + bytes[offset + 3]! * 128 + (bytes[offset + 4]! >> 1);
}

it("MPEG-TS delays video PTS and DTS equally and wraps PCR on the 33-bit clock", () => {
  const doc = parseMp4(createSyntheticMp4({ width: 16, height: 16, frameCount: 1, includeAudio: false }));
  const track = doc.tracks[0]!;
  const sample = track.samples[0]!;
  for (const dts of [0, 2 ** 33 - 1000]) {
    for (const delay of [undefined, 0, 0.2]) {
      const delayed = Math.round((delay ?? 0.7) * 90000);
      const bytes = serializeMpegTs({ ...doc, tracks: [{ ...track, timescale: 90000,
        samples: [{ ...sample, dts, pts: dts + 1800, cts: 1800 }] }] }, { muxDelay: delay });
      let offset = 0;
      while (!(bytes[offset + 3]! & 32) || !(bytes[offset + 5]! & 16)) offset += 188;
      const packet = Buffer.from(bytes.subarray(offset, offset + 188));
      assert.ok(packet[5]! & 16);
      const pcr = packet.readUInt32BE(6) * 2 + (packet[10]! >> 7);
      assert.equal(pcr, (dts + delayed) % 2 ** 33);
      const pes = 5 + packet[4]!;
      assert.equal(timestamp(packet, pes + 9), (dts + 1800 + 2 * delayed) % 2 ** 33);
      assert.equal(timestamp(packet, pes + 14), (dts + 2 * delayed) % 2 ** 33);
    }
  }
});

it("MPEG-TS rejects invalid SDK mux delays", () => {
  const doc = parseMp4(createSyntheticMp4({ width: 16, height: 16, frameCount: 1, includeAudio: false }));
  for (const muxDelay of [-1, NaN, Infinity, 2148]) {
    assert.throws(() => serializeMpegTs(doc, { muxDelay }), /muxdelay/);
  }
});
