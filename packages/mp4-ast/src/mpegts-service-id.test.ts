import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { parseMp4 } from "./mp4.js";
import { parseMpegTs, serializeMpegTs } from "./containers/mpegts.js";

const input = parseMp4(new Uint8Array(readFileSync(new URL("./fixtures/aac-copy.m4a", import.meta.url))));

for (const serviceId of [undefined, 1, 42, 256, 65535]) {
  it(`writes service ID ${serviceId ?? "default"} in every MPEG-TS table without changing AAC packets`, () => {
    const bytes = serializeMpegTs(input, { mpegtsServiceId: serviceId });
    const sections = new Map<number, Buffer>();
    for (let offset = 0; offset < bytes.length; offset += 188) {
      const packet = Buffer.from(bytes.subarray(offset, offset + 188));
      assert.equal(packet[0], 0x47);
      const pid = packet.readUInt16BE(1) & 8191;
      if (![0, 17, 4096].includes(pid)) continue;
      const start = 5 + packet[4]!;
      const section = packet.subarray(start, start + 3 + (packet.readUInt16BE(start + 1) & 4095));
      let crc = 0xffffffff;
      for (const byte of section) {
        crc ^= byte << 24;
        for (let bit = 0; bit < 8; bit++) crc = (crc << 1) ^ (crc & 0x80000000 ? 0x04c11db7 : 0);
      }
      assert.equal(crc >>> 0, 0, `valid CRC for PID ${pid}`);
      sections.set(pid, section);
    }
    const expected = serviceId ?? 1;
    assert.equal(sections.get(0)!.readUInt16BE(8), expected, "PAT program");
    assert.equal(sections.get(0)!.readUInt16BE(10) & 8191, 4096, "PMT PID");
    assert.equal(sections.get(4096)!.readUInt16BE(3), expected, "PMT program");
    assert.ok(sections.has(17), "SDT is present");
    assert.equal(sections.get(17)!.readUInt16BE(11), expected, "SDT service");
    assert.equal(sections.get(17)!.readUInt16BE(3), 1, "transport stream ID remains 1");
    const output = parseMpegTs(bytes);
    assert.deepEqual(output.tracks.find(track => track.type === "audio")!.samples.map(sample => sample.data),
      input.tracks.find(track => track.type === "audio")!.samples.map(sample => sample.data));
  });
}

for (const serviceId of [0, -1, 65536, 1.5, NaN, Infinity]) {
  it(`rejects invalid serializer service ID ${serviceId}`, () => {
    assert.throws(() => serializeMpegTs(input, { mpegtsServiceId: serviceId }), /mpegts_service_id/);
  });
}
