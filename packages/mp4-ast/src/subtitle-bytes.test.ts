import assert from "node:assert/strict";
import { it } from "node:test";
import { parseSubtitleDocument, serializeSubtitleDocument } from "./containers/adapters.js";

for (const format of ["srt", "webvtt"] as const) {
  it(`serializes ${format} dialogue bytes without UTF-8 replacement`, () => {
    const dialogue = Buffer.from([0x43, 0x61, 0x66, 0xe9, 0x20, 0x80]);
    const input = Buffer.concat([Buffer.from("1\n00:00:01,000 --> 00:00:02,000\n"), dialogue, Buffer.from("\n\n")]);
    const doc = parseSubtitleDocument(input, "srt");
    const expected = format === "srt" ? input : Buffer.concat([
      Buffer.from("WEBVTT\n\n00:01.000 --> 00:02.000\n"), dialogue, Buffer.from("\n")
    ]);
    assert.deepEqual(serializeSubtitleDocument(doc, format), new Uint8Array(expected));
  });
}
