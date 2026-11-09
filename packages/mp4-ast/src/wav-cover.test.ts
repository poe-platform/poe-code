import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { parseWav, probeWavSource, probeWavStream, wavAst } from "./index.js";

// Synthetic PCM16 WAV containing a native ID3v2.3 APIC frame.
const input = readFileSync(new URL("./fixtures/wav-cover.wav", import.meta.url));
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAMAAAACCAIAAAASFvFNAAAAFUlEQVQI12NkYPjPwMDAwMDAxAADABErAQPyz1XMAAAAAElFTkSuQmCC", "base64");

for (const id of ["id3 ", "ID3 "]) for (const afterData of [false, true]) {
  it(`discovers WAV ${id} artwork before/after PCM (${afterData}) across all readers`, async () => {
    const chunk = Buffer.from(input.subarray(36, 160));
    chunk.write(id);
    const bytes = Buffer.concat([input.subarray(0, 36), ...(afterData ? [input.subarray(160), chunk] : [chunk, input.subarray(160)])]);
    const doc = parseWav(bytes, { decodeAudio: false });
    assert.equal(doc.tracks.length, 2);
    assert.equal(doc.tracks[0]!.type, "audio");
    assert.equal(doc.tracks[0]!.duration, 8000);
    assert.deepEqual(Buffer.from(doc.tracks[1]!.samples[0]!.data), png);
    const source = await probeWavSource({ size: bytes.length, async read(offset, length) {
      // Metadata probing must not read PCM payloads, even with short borrowed reads.
      const start = afterData ? 44 : 168;
      assert.ok(offset + length <= start || offset >= start + 16000);
      return bytes.subarray(offset, offset + Math.min(length, 7));
    } });
    const stream = await probeWavStream((async function* () {
      const borrowed = new Uint8Array(7);
      for (let offset = 0; offset < bytes.length; offset += 7) {
        const part = bytes.subarray(offset, offset + 7); borrowed.set(part); yield borrowed.subarray(0, part.length);
      }
    })());
    for (const probe of [wavAst().probe(bytes), source, stream]) {
      assert.equal(probe.format.nb_streams, 2);
      assert.equal(probe.streams[0]!.codec_name, "pcm_s16le");
      const picture = probe.streams[1]!;
      assert.equal(picture.index, 1);
      assert.equal(picture.codec_name, "png");
      assert.equal(picture.width, 3);
      assert.equal(picture.height, 2);
      assert.equal(picture.disposition!.attached_pic, 1);
      assert.deepEqual(picture.tags, { title: "Front", comment: "Cover (front)" });
    }
  });
}
