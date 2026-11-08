import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { muxMp4, parseMp4, probeMp4, serializeMp4, sliceMp4 } from "./index.js";

// Native FFmpeg fixture: one second of H.264 and 8 kHz AAC with 1024 priming samples.
const input = new Uint8Array(readFileSync(new URL("./fixtures/packet-positions-interleaved.mp4", import.meta.url)));

for (const duration of [1, 0.5]) {
  it(`shortest mux retains AAC priming when ending at ${duration}s`, () => {
    const doc = parseMp4(input);
    const audio = doc.tracks.find(track => track.type === "audio")!;
    const video = doc.tracks.find(track => track.type === "video")!;
    const output = parseMp4(serializeMp4(muxMp4([{
      ...doc, tracks: [{ ...video, duration: duration * video.timescale }, audio]
    }], { shortest: true })));
    const actual = output.tracks.find(track => track.type === "audio")!;
    const endTick = audio.editList![0]!.mediaTime + duration * audio.timescale;
    assert.equal(actual.samples.length, audio.samples.filter(sample => sample.dts < endTick).length);
    assert.deepEqual(actual.samples.map(sample => sample.data),
      audio.samples.filter(sample => sample.dts < endTick).map(sample => sample.data));
    assert.equal(actual.duration / actual.timescale, duration);
    assert.equal(actual.editList![0]!.mediaTime, 1024);
    const packets = probeMp4(serializeMp4(output), { showPackets: true }).packets!;
    assert.equal(Number(packets.find(packet => packet.stream_index === 1)!.pts_time), -0.128);
  });
}

it("retains priming when slicing from zero but honors a positive start", () => {
  const doc = parseMp4(input);
  const audio = doc.tracks.find(track => track.type === "audio")!;
  const audioDoc = { ...doc, tracks: [audio] };
  assert.deepEqual(sliceMp4(audioDoc, { durationSeconds: 0.5 }).tracks[0]!.samples[0]!.data,
    audio.samples[0]!.data);
  const later = sliceMp4(audioDoc, { startSeconds: 0.256, durationSeconds: 0.5 });
  assert.deepEqual(later.tracks[0]!.samples[0]!.data, audio.samples[3]!.data);
});
