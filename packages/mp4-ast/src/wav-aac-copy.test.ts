import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { parseMp4, parseWav, serializeWav } from "./index.js";
import { readWavHeader } from "./containers/wav-header.js";

// Synthetic mono AAC; reference: FFmpeg 7.0.2 -i aac-copy.m4a -map 0:a:0 -c:a copy out.wav.
const input = readFileSync(new URL("./fixtures/aac-copy.m4a", import.meta.url));

it("copies M4A AAC packets and codec configuration into WAV without decoding", () => {
  const doc = parseMp4(input);
  const track = doc.tracks[0]!;
  assert.equal(track.decodedAudio, undefined);
  const output = serializeWav(doc, { audioCodec: "copy" });
  const header = readWavHeader(output);
  assert.equal(header.formatTag, 0xff);
  assert.equal(header.sampleRate, 48000);
  assert.equal(header.channels, 1);
  assert.equal(header.factSampleCount, 35584); // Includes the copied priming packet.
  assert.equal(header.dataSize, 6631);
  assert.equal(Buffer.from(output.subarray(header.formatOffset!, header.formatOffset! + header.formatSize!)).toString("hex"),
    "ff00010080bb0000f0220000000310000500118856e50000");
  const payload = output.subarray(header.dataOffset, header.dataOffset + header.dataSize);
  assert.equal(createHash("sha256").update(payload).digest("hex"),
    "5263e668cb6611c2ee7a6c41d32bfd091b84eaf75a6884b2696f627d9d477f99");
  assert.deepEqual(Buffer.from(payload), Buffer.concat(track.samples.map(sample => sample.data)));
  assert.deepEqual(serializeWav(doc, { audioCodec: "copy", writeHeader: false }), payload);
  const copied = serializeWav(parseWav(output, { decodeAudio: false }), { audioCodec: "copy" });
  assert.deepEqual(copied, output);
});

it("does not decode or rewrite AAC packets when decoded audio is also available", () => {
  const doc = parseMp4(input);
  const track = doc.tracks[0]!;
  const output = serializeWav({ ...doc, tracks: [{ ...track,
    decodedAudio: { sampleRate: 48000, channels: 1, channelData: [new Float32Array(1)] },
    samples: [{ ...track.samples[0]!, data: Uint8Array.of(255, 0, 1), size: 3 }]
  }] }, { audioCodec: "copy" });
  const header = readWavHeader(output);
  assert.equal(header.factSampleCount, 1024);
  assert.deepEqual(output.subarray(header.dataOffset, header.dataOffset + header.dataSize), Uint8Array.of(255, 0, 1));
});
