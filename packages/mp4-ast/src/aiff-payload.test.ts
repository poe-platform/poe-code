import assert from "node:assert/strict";
import { it } from "node:test";
import { aiffAst } from "./containers/aiff.js";

it("exposes each demuxed AIFF packet without copying or including SSND padding", () => {
  const payload = Buffer.from(Array.from({ length: 2050 }, (_, i) => i % 251));
  const bytes = Buffer.concat([
    Buffer.from("464f524d0000004041494646434f4d4d000000120001000004010010400bfa0000000000000053534e4400000019000000070000001000010203040506", "hex"),
    payload, Buffer.from([0])
  ]);
  bytes.writeUInt32BE(bytes.length - 8, 4);
  bytes.writeUInt32BE(15 + payload.length, 42);
  const plugin = aiffAst();
  const probe = plugin.probe(bytes, { showPackets: true });
  assert.equal(probe.packets!.length, 3);
  let offset = 0;
  for (const packet of probe.packets!) {
    const data = probe.packetData!.get(`${packet.pos}:${packet.size}`)!;
    assert.equal(data.buffer, bytes.buffer);
    assert.deepEqual(data, payload.subarray(offset, offset + Number(packet.size)));
    offset += data.length;
  }
  assert.equal(offset, payload.length);
  assert.equal(plugin.probe(bytes).packetData, undefined);
});
