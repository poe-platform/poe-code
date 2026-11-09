import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { parseMp4, serializeMp4 } from "./mp4.js";
import { rawAudioAsts } from "./containers/raw-audio.js";

const input = readFileSync(new URL("./fixtures/amr-nb-decode.3gp", import.meta.url));
const reference = readFileSync(new URL("./fixtures/amr-nb.s16", import.meta.url));

it("decodes seven AMR-NB frames in 3GP to native mono 8000 Hz PCM", () => {
  const doc = parseMp4(input);
  const audio = doc.tracks[0]!.decodedAudio!;
  assert.ok(audio);
  assert.equal(audio.sampleRate, 8000);
  assert.equal(audio.channels, 1);
  const pcm = Buffer.from(rawAudioAsts().find(plugin => plugin.id === "s16le")!.serialize(doc));
  assert.equal(pcm.length, 2240);
  for (let offset = 0; offset < pcm.length; offset += 2) {
    assert.ok(Math.abs(pcm.readInt16LE(offset) - reference.readInt16LE(offset)) <= 2, `sample ${offset / 2}`);
  }
});

it("preserves compressed AMR-NB packets when decoding is disabled", () => {
  const doc = parseMp4(input, { decodeAudio: false });
  const track = doc.tracks[0]!;
  assert.equal(track.decodedAudio, undefined);
  assert.equal(track.codecDescriptions[0]!.codecName, "amr_nb");
  const copy = parseMp4(serializeMp4(doc), { decodeAudio: false });
  assert.deepEqual(copy.tracks[0]!.samples.map(sample => Buffer.from(sample.data)), track.samples.map(sample => Buffer.from(sample.data)));
});

it("decodes multiple AMR-NB frames per packet and rejects truncated frames", () => {
  const doc = parseMp4(input, { decodeAudio: false });
  const track = doc.tracks[0]!;
  const first = track.samples[0]!;
  const data = Buffer.concat(track.samples.map(sample => Buffer.from(sample.data)));
  const packed = { ...doc, tracks: [{ ...track, samples: [{ ...first, data, duration: 1120 }] }] };
  assert.deepEqual(parseMp4(serializeMp4(packed)).tracks[0]!.decodedAudio, parseMp4(input).tracks[0]!.decodedAudio);
  const truncated = { ...doc, tracks: [{ ...track, samples: [{ ...first, data: data.subarray(0, 31) }] }] };
  assert.throws(() => parseMp4(serializeMp4(truncated)), /AMR-NB frame/);
  assert.throws(() => parseMp4(input, { limits: { maxMemoryBytes: 4000 } }), /maxMemoryBytes/);
});
