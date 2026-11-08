import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { parseMp4, probeMp4, serializeMp4, sliceMp4 } from "./index.js";

it("extends the audio edit through the last copied packet while retaining priming", () => {
  const source = parseMp4(readFileSync(new URL("./fixtures/packet-positions-interleaved.mp4", import.meta.url)));
  const audio = source.tracks.find(track => track.type === "audio")!;
  const document = { ...source, tracks: [audio] };
  const exact = sliceMp4(document, { durationSeconds: 0.31 });
  assert.equal(exact.durationSeconds, 0.31);
  const copied = sliceMp4(document, { durationSeconds: 0.31, copyAudio: true });
  const probe = probeMp4(serializeMp4(copied), { showPackets: true });
  assert.deepEqual(probe.packets!.map(packet => [packet.pts, packet.duration]),
    [[-1024, 1024], [0, 1024], [1024, 1024], [2048, 1024]]);
  assert.deepEqual(copied.tracks[0]!.samples.map(sample => sample.data),
    audio.samples.slice(0, 4).map(sample => sample.data));
  assert.equal(copied.durationSeconds, 0.384);
  assert.equal(probe.packets![0]!.side_data_list?.[0]?.skip_samples, 1024);
});
