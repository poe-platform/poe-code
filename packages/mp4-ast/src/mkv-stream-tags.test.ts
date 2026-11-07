import assert from "node:assert/strict";
import { it } from "node:test";
import { probeMkv } from "./containers/mkv.js";
import { writeVintSize } from "./containers/ebml.js";

function element(id: number[], ...children: Uint8Array[]): Uint8Array {
  const payload = Buffer.concat(children);
  return Buffer.concat([Uint8Array.from(id), writeVintSize(payload.length), payload]);
}
const text = (value: string) => new TextEncoder().encode(value);

it("matches exact 64-bit UIDs with tags before tracks and keeps non-track targets out of the format", () => {
  const uid = Uint8Array.of(0x20, 0, 0, 0, 0, 0, 0, 1);
  const otherUid = Uint8Array.of(0x20, 0, 0, 0, 0, 0, 0, 0);
  const simple = (value: string) => element([0x67, 0xc8],
    element([0x45, 0xa3], text("ARTIST")), element([0x44, 0x87], text(value)));
  const tag = (target: number[], value: Uint8Array, name: string) => element([0x73, 0x73],
    simple(name), element([0x63, 0xc0], element(target, value)));
  const track = (number: number, value: Uint8Array) => element([0xae],
    element([0xd7], Uint8Array.of(number)), element([0x73, 0xc5], value),
    element([0x83], Uint8Array.of(17)), element([0x86], text("S_TEXT/UTF8")));
  const input = element([0x1a, 0x45, 0xdf, 0xa3]);
  const segment = element([0x18, 0x53, 0x80, 0x67],
    element([0x12, 0x54, 0xc3, 0x67],
      tag([0x63, 0xc5], uid, "Alice"), tag([0x63, 0xc5], otherUid, "Bob"),
      tag([0x63, 0xc4], Uint8Array.of(1), "Chapter"),
      tag([0x63, 0xc6], Uint8Array.of(1), "Attachment"),
      tag([0x63, 0xc9], Uint8Array.of(1), "Edition")),
    element([0x16, 0x54, 0xae, 0x6b], track(1, uid), track(2, otherUid)));
  const probe = probeMkv(Buffer.concat([input, segment]));
  assert.deepEqual(probe.streams.map(stream => stream.tags), [
    { language: "eng", ARTIST: "Alice" }, { language: "eng", ARTIST: "Bob" }
  ]);
  assert.equal(probe.format.tags?.artist, undefined);
});
