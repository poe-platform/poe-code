import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { inflateSync } from "node:zlib";
import { it } from "node:test";
import { parseMp4, parseWav, serializeWav } from "./index.js";

// External H.264/AAC source; reference: ffmpeg -i aac-external.mp4 -vn -c:a pcm_f32le -f f32le.
const source = readFileSync(new URL("./fixtures/aac-external.mp4", import.meta.url));
const reference = inflateSync(readFileSync(new URL("./fixtures/aac-reference.f32.zlib", import.meta.url)));

it("extracts the complete external AAC waveform with priming removed", () => {
  const pcm = parseWav(serializeWav(parseMp4(source))).tracks[0]!.decodedAudio!;
  assert.equal(pcm.sampleRate, 24000);
  assert.equal(pcm.channels, 1);
  assert.equal(pcm.channelData[0]!.length, 192000);
  const view = new DataView(reference.buffer, reference.byteOffset, reference.byteLength);
  let maximumError = 0;
  for (let i = 0; i < 192000; i++) {
    maximumError = Math.max(maximumError, Math.abs(pcm.channelData[0]![i]! - view.getFloat32(i * 4, true)));
  }
  assert.ok(maximumError < 0.00008, `maximum waveform error: ${maximumError}`);
});

it("honors multiple edits and explicit empty edits without losing waveform samples", () => {
  const doc = parseMp4(source);
  const track = doc.tracks.find(track => track.type === "audio")!;
  const edited = { ...track, editList: [
    { segmentDuration: 240, mediaTime: -1, mediaRateInteger: 1, mediaRateFraction: 0 },
    { segmentDuration: 1200, mediaTime: 1024 + 3000, mediaRateInteger: 1, mediaRateFraction: 0 },
    { segmentDuration: 600, mediaTime: 1024 + 7000, mediaRateInteger: 1, mediaRateFraction: 0 }
  ] };
  const full = parseWav(serializeWav(doc)).tracks[0]!.decodedAudio!.channelData[0]!;
  const result = parseWav(serializeWav({ ...doc, tracks: [edited] })).tracks[0]!.decodedAudio!.channelData[0]!;
  assert.deepEqual(result, Float32Array.from([...new Float32Array(240), ...full.slice(3000, 4200), ...full.slice(7000, 7600)]));
});

it("rejects corrupt packets, missing presentation segments and unsupported edit rates", () => {
  const doc = parseMp4(source);
  const track = doc.tracks.find(track => track.type === "audio")!;
  for (const samples of [
    track.samples.filter((_, index) => index !== 20),
    track.samples.slice(0, -1),
    track.samples.map((sample, index) => index === 20 ? { ...sample, data: Uint8Array.of(255) } : sample)
  ]) {
    assert.throws(() => serializeWav({ ...doc, tracks: [{ ...track, samples }] }), /AAC/);
  }
  assert.throws(() => serializeWav({ ...doc, tracks: [{ ...track,
    editList: track.editList!.map(edit => ({ ...edit, mediaRateInteger: 2 })) }] }), /AAC edit/);
});
