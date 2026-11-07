import assert from "node:assert/strict";
import { it } from "node:test";
import { parseMkv, probeMkv } from "./containers/mkv.js";
import { writeVintSize } from "./containers/ebml.js";

function element(id: number[], ...children: Uint8Array[]): Uint8Array {
  const payload = Buffer.concat(children);
  return Buffer.concat([Uint8Array.from(id), writeVintSize(payload.length), payload]);
}
const text = (value: string) => new TextEncoder().encode(value);

it("retains multiple attachment names, MIME types and descriptions before tracks without creating samples", () => {
  const attachment = (name: string, mime: string, data: string) => element([0x61, 0xa7],
    element([0x46, 0x5c], text(data)),
    element([0x46, 0x6e], text(name)),
    element([0x46, 0x60], text(mime)),
    element([0x46, 0x7e], text("Speaker notes")));
  const bytes = Buffer.concat([
    element([0x1a, 0x45, 0xdf, 0xa3]),
    element([0x18, 0x53, 0x80, 0x67],
      element([0x19, 0x41, 0xa4, 0x69],
        attachment("guide.txt", "text/plain", "notes"),
        attachment("data.bin", "application/octet-stream", "data"),
        attachment("empty.txt", "text/plain", "")),
      element([0x16, 0x54, 0xae, 0x6b], element([0xae],
        element([0xd7], Uint8Array.of(1)),
        element([0x83], Uint8Array.of(17)),
        element([0x86], text("S_TEXT/UTF8")))))
  ]);
  const doc = parseMkv(bytes);
  assert.equal(doc.tracks.length, 1);
  const probe = probeMkv(bytes, { showPackets: true, showFrames: true });
  assert.equal(probe.format.nb_streams, 3);
  assert.deepEqual(probe.streams.map(stream => [stream.index, stream.codec_type]), [[0, "subtitle"], [1, "attachment"], [2, "attachment"]]);
  assert.deepEqual(probe.streams.slice(1).map(stream => stream.tags), [
    { filename: "guide.txt", mimetype: "text/plain", title: "Speaker notes" },
    { filename: "data.bin", mimetype: "application/octet-stream", title: "Speaker notes" }
  ]);
  assert.deepEqual(probe.streams.slice(1).map(stream => stream.extradata_size), [5, 4]);
  assert.deepEqual(probe.packets, []);
  assert.deepEqual(probe.frames, []);
});
