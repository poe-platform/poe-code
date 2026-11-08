import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { parseMp4, serializeMp4, serializeSubtitleDocument } from "./index.js";

// Native FFmpeg: -i timed-text.srt -c:s mov_text timed-text-styles.mp4
it("decodes native mov_text style spans without styling adjacent text", () => {
  const bytes = readFileSync(new URL("./fixtures/timed-text-styles.mp4", import.meta.url));
  const doc = parseMp4(bytes);
  assert.equal(new TextDecoder().decode(serializeSubtitleDocument(doc, "srt")),
    "1\n00:00:00,250 --> 00:00:01,125\nPlain <i>slant</i> <b>bold</b>\nNext line\n\n");
});

it("handles Unicode character offsets, combined styles and malformed style boxes", async () => {
  const { decodeMovText } = await import("./mov-text.js");
  const text = Buffer.from("é😀 hi end");
  const header = Buffer.alloc(2);
  header.writeUInt16BE(text.length);
  const box = Buffer.alloc(22);
  box.writeUInt32BE(box.length);
  box.write("styl", 4);
  box.writeUInt16BE(1, 8);
  box.writeUInt16BE(3, 10);
  box.writeUInt16BE(5, 12);
  box[16] = 7;
  const decode = (suffix: Uint8Array) => new TextDecoder().decode(decodeMovText(Buffer.concat([header, text, suffix])));
  assert.equal(decode(box), "é😀 <b><i><u>hi</u></i></b> end");
  assert.equal(decode(box.subarray(0, 21)), "é😀 hi end");
  box.writeUInt16BE(2, 8);
  assert.equal(decode(box), "é😀 hi end");
  box.writeUInt32BE(0);
  assert.equal(decode(box), "é😀 hi end");
});

it("preserves encoded timed-text packets and styles for stream copy", () => {
  const bytes = readFileSync(new URL("./fixtures/timed-text-styles.mp4", import.meta.url));
  const doc = parseMp4(bytes, { decodeSubtitles: false });
  const samples = doc.tracks[0]!.samples;
  assert.deepEqual(Array.from(samples[0]!.data), [0, 0]);
  assert.equal(samples.length, 3);
  const copied = parseMp4(serializeMp4(doc), { decodeSubtitles: false });
  assert.deepEqual(copied.tracks[0]!.samples.map(s => s.data), samples.map(s => new Uint8Array(s.data)));
});
