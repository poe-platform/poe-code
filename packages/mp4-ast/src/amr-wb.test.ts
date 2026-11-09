import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { decodeAudio } from "@poe-code/media-codecs";
import { parseMp4 } from "./mp4.js";

const input = readFileSync(new URL("./fixtures/amr-wb.3gp", import.meta.url));
const reference = readFileSync(new URL("./fixtures/amr-wb.s16", import.meta.url));

it("decodes six AMR-WB frames to mono 16 kHz PCM", () => {
  const track = parseMp4(input).tracks[0]!;
  assert.equal(track.samples.length, 6);
  assert.equal(track.codecDescriptions[0]!.codecName, "amr_wb");
  const audio = track.decodedAudio!;
  assert.equal(audio.sampleRate, 16000);
  assert.equal(audio.channels, 1);
  assert.equal(audio.channelData[0]!.length, 1920);
  for (let i = 0; i < 1920; i++) {
    assert.ok(Math.abs(audio.channelData[0]![i]! * 32768 - reference.readInt16LE(i * 2)) <= 2, `PCM sample ${i}`);
  }
});

it("keeps AMR-WB packet reads independent of decoding and enforces PCM memory limits", () => {
  const track = parseMp4(input, { decodeAudio: false }).tracks[0]!;
  assert.equal(track.decodedAudio, undefined);
  assert.throws(() => parseMp4(input, { limits: { maxMemoryBytes: 4000 } }), /maxMemoryBytes/);
  const malformed = Buffer.from(input);
  malformed[track.samples[0]!.offset!] = 0x54; // Reserved AMR-WB frame type 10.
  assert.throws(() => parseMp4(malformed), /AMR-WB/);
  assert.equal(parseMp4(malformed, { decodeAudio: false }).tracks[0]!.samples.length, 6);
});

it("releases AMR-WB decoder state after errors and early iterator disposal", () => {
  const packets = parseMp4(input, { decodeAudio: false }).tracks[0]!.samples;
  for (let attempt = 0; attempt < 3; attempt++) {
    assert.throws(() => [...decodeAudio("AMR-WB", [{ ...packets[0]!, data: Uint8Array.of(0x54) }])], /AMR-WB/);
    const frames = decodeAudio("AMR-WB", packets);
    assert.equal(frames.next().value!.channelData[0]!.length, 320);
    frames.return(undefined);
    assert.equal([...decodeAudio("AMR-WB", packets)].length, 6);
  }
});
