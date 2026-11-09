import { expect, it } from "vitest";
import { encodeOgg, readOgg } from "./ogg.js";

it("retains the starting page offset for every Ogg packet, including continuations", () => {
  const bytes = encodeOgg([
    { data: Uint8Array.of(1), serial: 7, granule: 0n, bos: true, eos: false },
    { data: Uint8Array.of(2), serial: 7, granule: 0xffffffffffffffffn, bos: false, eos: false },
    { data: Uint8Array.of(3), serial: 7, granule: 960n, bos: false, eos: false },
    { data: new Uint8Array(70000).fill(4), serial: 7, granule: 1920n, bos: false, eos: true }
  ]);
  const { packets, nodes } = readOgg(bytes);
  expect(nodes).toHaveLength(4);
  expect(packets.map(packet => packet.offset)).toEqual([0, 29, 29, 60]);
  expect(nodes[2]!.offset).toBe(60);
  expect(packets[3]!.data).toEqual(new Uint8Array(70000).fill(4));
});
