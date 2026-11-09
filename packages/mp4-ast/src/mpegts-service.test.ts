import assert from "node:assert/strict";
import { it } from "node:test";
import { parseMpegTs, serializeMpegTs } from "./containers/mpegts.js";
import type { MediaDocument } from "./types.js";

const doc: MediaDocument = {
  containerFormat: "mpegts", timescale: 90000, duration: 0, durationSeconds: 0,
  tracks: [], metadata: {}
};

function section(bytes: Uint8Array, pid: number): Buffer {
  const chunks: Uint8Array[] = [];
  for (let offset = 0; offset < bytes.length; offset += 188) {
    const packet = bytes.subarray(offset, offset + 188);
    assert.equal(packet[0], 0x47);
    if (((packet[1]! & 31) << 8 | packet[2]!) !== pid) continue;
    assert.equal(packet[3]! & 15, chunks.length & 15);
    assert.equal(Boolean(packet[1]! & 64), chunks.length === 0);
    const start = packet[1]! & 64 ? 5 + packet[4]! : 4;
    chunks.push(packet.subarray(start));
  }
  assert.ok(chunks.length > 0, `missing PSI PID ${pid}`);
  const data = Buffer.concat(chunks);
  const length = 3 + (data.readUInt16BE(1) & 4095);
  assert.ok(data.length >= length, "complete section including CRC");
  assert.ok(data.subarray(length).every(byte => byte === 255), "packet stuffing");
  return data.subarray(0, length);
}

for (const metadata of [
  {}, { service_name: "Workshop" }, { service_provider: "Studio" },
  { service_name: "Workshop", service_provider: "Studio" }
]) {
  it(`writes an SDT linked to PAT/PMT for ${JSON.stringify(metadata)}`, () => {
    const bytes = serializeMpegTs({ ...doc, metadata: { custom: metadata } });
    const pat = section(bytes, 0), pmt = section(bytes, 0x1000), sdt = section(bytes, 0x11);
    assert.equal(sdt[0], 0x42);
    assert.equal(sdt[1]! & 0xf0, 0xf0);
    assert.equal(sdt.readUInt16BE(3), pat.readUInt16BE(3));
    assert.equal(sdt.readUInt16BE(11), pat.readUInt16BE(8));
    assert.equal(sdt.readUInt16BE(11), pmt.readUInt16BE(3));
    assert.equal(sdt.readUInt16BE(8), 0xff01);
    assert.equal(sdt[13], 0xfc);
    assert.equal(sdt[14]! >> 4, 8); // running, unscrambled
    assert.equal(sdt[16], 0x48);
    assert.equal(sdt[18], 1); // digital television, including audio-only output
    const provider = metadata.service_provider ?? "FFmpeg";
    const name = metadata.service_name ?? "Service01";
    assert.equal(sdt[19], provider.length);
    assert.equal(sdt.subarray(20, 20 + provider.length).toString(), provider);
    assert.equal(sdt[20 + provider.length], name.length);
    assert.equal(sdt.subarray(21 + provider.length, -4).toString(), name);
    assert.equal(sdt[17], 3 + provider.length + name.length);
    assert.equal(sdt.readUInt16BE(14) & 4095, 5 + provider.length + name.length);
    assert.deepEqual(parseMpegTs(bytes).services.get(1), { service_name: name, service_provider: provider });
    if (metadata.service_name && metadata.service_provider) {
      // SDT from native FFmpeg 7.0.2 with the same metadata.
      assert.equal(sdt.toString("hex"), "42f0240001c10000ff01ff0001fc80134811010653747564696f08576f726b73686f707c56b7f1");
    }
  });
}

it("writes long service descriptors across packets without truncating the section", () => {
  const bytes = serializeMpegTs(doc, { metadata: { custom: { service_name: "N".repeat(200), service_provider: "Studio" } } });
  const sdt = section(bytes, 0x11);
  assert.equal(sdt.length, 231);
  assert.equal(sdt[17], 209);
  assert.equal(sdt.subarray(27, -4).toString(), "N".repeat(200));
  assert.deepEqual(parseMpegTs(bytes).services.get(1), { service_name: "N".repeat(200), service_provider: "Studio" });
});

it("rejects a service descriptor that cannot fit its one-byte length", () => {
  assert.throws(() => serializeMpegTs(doc, { metadata: { custom: { service_name: "N".repeat(253) } } }), /service descriptor.*255/i);
});

it("marks non-ASCII service text as DVB UTF-8 and counts encoded bytes", () => {
  const bytes = serializeMpegTs(doc, { metadata: { custom: { service_name: "Café", service_provider: "放送" } } });
  const sdt = section(bytes, 0x11);
  assert.equal(sdt[19], 7);
  assert.deepEqual(sdt.subarray(20, 27), Buffer.from("\x15放送"));
  assert.equal(sdt[27], 6);
  assert.deepEqual(sdt.subarray(28, -4), Buffer.from("\x15Café"));
  assert.deepEqual(parseMpegTs(bytes).services.get(1), { service_name: "Café", service_provider: "放送" });
});
