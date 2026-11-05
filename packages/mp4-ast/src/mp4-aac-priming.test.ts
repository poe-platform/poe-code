import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { parseMp4, probeMp4, probeMp4Source, serializeMp4 } from './index.js';

function syncSamples() {
  const keys = new Set<number>();
  return { add(n: number) { keys.add(n); }, has(n: number) { return keys.has(n); } };
}

for (const [fixture, audioPackets, videoFrames] of [
  ['packet-positions-interleaved.mp4', 9, 5], ['aac-external.mp4', 189, 80]
] as const) {
  test(`AAC priming remains a packet but produces no frame: ${fixture}`, async () => {
    const bytes = readFileSync(new URL(`./fixtures/${fixture}`, import.meta.url));
    const source = await probeMp4Source({ size: bytes.length,
      async read(offset, length) { return bytes.subarray(offset, offset + length); }
    }, { showPackets: true, showFrames: true, syncSamples });
    const streams = [], packets = [], frames = [];
    for await (const row of source.streams) streams.push(row);
    for await (const row of source.packets!) packets.push(row);
    for await (const row of source.frames!) frames.push(row);
    for (const probe of [{ streams, packets, frames }, probeMp4(bytes, { showPackets: true, showFrames: true })]) {
      assert.equal(probe.packets!.filter(row => row.codec_type === 'audio').length, audioPackets);
      const audio = probe.frames!.filter(row => row.media_type === 'audio');
      assert.equal(audio.length, audioPackets - 1);
      assert.equal(audio[0]!.pts, 0);
      assert.equal(probe.frames!.filter(row => row.media_type === 'video').length, videoFrames);
      const stream = probe.streams.find(row => row.codec_type === 'audio')!;
      assert.equal(stream.nb_frames, String(audioPackets));
      assert.equal(stream.nb_read_frames, String(audioPackets - 1));
    }
  });
}

for (const delayed of [false, true]) test(`AAC without priming / with delayed edit: ${delayed}`, async () => {
  const doc = parseMp4(readFileSync(new URL('./fixtures/packet-positions-interleaved.mp4', import.meta.url)));
  const track = doc.tracks.find(row => row.type === 'audio')!;
  const editList = delayed ? [
    { segmentDuration: doc.timescale, mediaTime: -1, mediaRateInteger: 1, mediaRateFraction: 0 },
    ...track.editList!
  ] : [];
  const bytes = serializeMp4({ ...doc, tracks: [{ ...track, editList }] });
  const source = await probeMp4Source({ size: bytes.length,
    async read(offset, length) { return bytes.subarray(offset, offset + length); }
  }, { showFrames: true, syncSamples });
  const frames = [];
  for await (const frame of source.frames!) frames.push(frame);
  for (const actual of [frames, probeMp4(bytes, { showFrames: true }).frames!]) {
    assert.equal(actual.length, delayed ? 8 : 9);
    assert.equal(actual[0]!.pts, delayed ? track.timescale : 0);
  }
});
