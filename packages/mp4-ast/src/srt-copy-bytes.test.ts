import assert from "node:assert/strict";
import { it } from "node:test";
import { parseSubtitleDocument, serializeSubtitleDocument } from "./containers/adapters.js";

for (const [name, payload] of [
  ["non-UTF-8", Buffer.from([0x43, 0x61, 0x66, 0xe9, 0x20, 0x80])],
  ["UTF-8", Buffer.from("Café €")]
] as const) {
  it(`preserves ${name} SubRip packet bytes when serializing`, () => {
    const input = Buffer.concat([
      Buffer.from("1\n00:00:01,000 --> 00:00:02,000\n"), payload, Buffer.from("\n\n")
    ]);
    const doc = parseSubtitleDocument(input, "srt");
    assert.deepEqual(Buffer.from(doc.tracks[0]!.samples[0]!.data), payload);
    assert.deepEqual(Buffer.from(serializeSubtitleDocument(doc, "srt")), input);
  });
}
