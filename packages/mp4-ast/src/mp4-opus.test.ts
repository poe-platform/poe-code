import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { oggAst, parseMp4, serializeMp4 } from "./index.js";

const input = readFileSync(new URL("./fixtures/opus-remux.ogg", import.meta.url));
for (const channels of [1, 2, 6]) {
  it(`writes the ${channels}-channel OpusHead fields in MP4 byte order`, () => {
    const doc = oggAst().parse(input, { decodeAudio: false });
    const track = doc.tracks[0]!;
    const header = new Uint8Array(channels === 6 ? 27 : 19);
    header.set(track.codecDescriptions[0]!.extraData!);
    header[9] = channels;
    const view = new DataView(header.buffer);
    view.setUint32(12, 44100, true); // Informational input rate; Opus timestamps stay at 48 kHz.
    view.setInt16(16, -256, true);
    if (channels === 6) header.set([1, 4, 2, 0, 4, 1, 2, 3, 5], 18);
    const output = serializeMp4({ ...doc, tracks: [{ ...track, codecDescriptions: [{
      ...track.codecDescriptions[0]!, channels, extraData: header
    }] }] }, { format: "mp4", audioCodec: "copy" });
    const copied = parseMp4(output, { decodeAudio: false }).tracks[0]!;
    assert.deepEqual(copied.codecDescriptions[0]!.dOps?.rawBytes, Uint8Array.from([
      0, channels, 1, 56, 0, 0, 172, 68, 255, 0,
      ...(channels === 6 ? [1, 4, 2, 0, 4, 1, 2, 3, 5] : [0])
    ]));
    assert.equal(copied.timescale, 48000);
    assert.equal(copied.duration, 36000);
    assert.equal(copied.editList?.[0]?.mediaTime, 312);
  });
}

for (const header of [new Uint8Array(0), new Uint8Array(19), Uint8Array.from([...new TextEncoder().encode("OpusHead"), 1, 6, 0, 0, 0, 0, 0, 0, 0, 0, 1])]) {
  it(`rejects incomplete Opus configuration (${header.length} bytes, mapping ${header[18]})`, () => {
    const doc = oggAst().parse(input, { decodeAudio: false });
    const track = doc.tracks[0]!;
    assert.throws(() => serializeMp4({ ...doc, tracks: [{ ...track, codecDescriptions: [{
      ...track.codecDescriptions[0]!, extraData: header
    }] }] }, { format: "mp4", audioCodec: "copy" }), /Invalid OpusHead/);
  });
}
