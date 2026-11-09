import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { parseMp4, serializeMp4 } from "./mp4.js";
import { rawAudioAsts } from "./containers/raw-audio.js";

// Native FFmpeg IMA4 MOV: 8200 stereo input frames, padded to 8256 on decode.
const input = readFileSync(new URL("./fixtures/mov-ima4.mov", import.meta.url));

it("decodes MOV IMA4 including final block padding to native PCM", () => {
  const doc = parseMp4(input);
  const pcm = rawAudioAsts().find(plugin => plugin.id === "s16le")!.serialize(doc);
  assert.equal(pcm.length, 33024);
  assert.equal(createHash("sha256").update(pcm).digest("hex"),
    "921245f6f96baf866c47b70039a91ac1c91e9ac9e71862c5cb65163b4aaab593");
});

it("preserves MOV IMA4 packets without decoding and bounds decoded memory", () => {
  const doc = parseMp4(input, { decodeAudio: false });
  assert.equal(doc.tracks[0]!.decodedAudio, undefined);
  const description = doc.tracks[0]!.codecDescriptions[0]!;
  assert.equal(description.codecName, "adpcm_ima_qt");
  assert.equal(description.channels, 2);
  assert.equal(description.sampleRate, 8000);
  const copy = parseMp4(serializeMp4(doc), { decodeAudio: false });
  assert.deepEqual(copy.tracks[0]!.samples.map(sample => Buffer.from(sample.data)), doc.tracks[0]!.samples.map(sample => Buffer.from(sample.data)));
  assert.throws(() => parseMp4(input, { limits: { maxMemoryBytes: 65536 } }), /maxMemoryBytes/);
});
