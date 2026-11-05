import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { it } from 'node:test';
import { parseMp4, probeMp4Source, scanMp4Frames, scanMp4Packets, serializeMp4 } from './index.js';

// ffmpeg -f lavfi -i 'testsrc=size=32x24:rate=5:duration=1' -c:v libx264
//   -pix_fmt yuv420p -g 5 -bf 2 -movflags +faststart h264-edit-list.mp4
// Timestamp expectations checked with native ffprobe -show_packets -show_frames.
function syncSamples() {
  const keys = new Set<number>();
  return { add(sample: number) { keys.add(sample); }, has(sample: number) { return keys.has(sample); } };
}

const fixture = readFileSync(new URL('./fixtures/h264-edit-list.mp4', import.meta.url));

it('applies the MP4 edit media start to packet and frame timestamps', async () => {
  assert.equal(parseMp4(fixture).tracks[0]!.editList![0]!.mediaTime, 4096);
  const source = { size: fixture.length, async read(offset: number, length: number) { return fixture.subarray(offset, offset + length); } };
  const records = await probeMp4Source(source, { showPackets: true, showFrames: true, syncSamples });
  const packets = [];
  for await (const packet of records.packets!) packets.push(packet);
  assert.deepEqual(packets.map(({ pts, dts, pts_time, dts_time }) => [pts, dts, pts_time, dts_time]), [
    [0, -4096, '0.000000', '-0.400000'],
    [2048, -2048, '0.200000', '-0.200000'],
    [4096, 0, '0.400000', '0.000000'],
    [6144, 2048, '0.600000', '0.200000'],
    [8192, 4096, '0.800000', '0.400000']
  ]);
  const frames = [];
  for await (const frame of records.frames!) frames.push(frame);
  assert.deepEqual(frames.map(({ pts, pts_time, best_effort_timestamp, best_effort_timestamp_time }) =>
    [pts, pts_time, best_effort_timestamp, best_effort_timestamp_time]), [
    [0, '0.000000', 0, '0.000000'],
    [2048, '0.200000', 2048, '0.200000'],
    [4096, '0.400000', 4096, '0.400000'],
    [6144, '0.600000', 6144, '0.600000'],
    [8192, '0.800000', 8192, '0.800000']
  ]);
  assert.equal(records.format.start_time, '0.000000');
  assert.equal(records.format.duration, '1.000000');
  for await (const stream of records.streams) {
    assert.equal(stream.start_pts, 0);
    assert.equal(stream.duration_ts, 10240);
  }
});

for (const delayed of [false, true]) it(`preserves the edit-list empty delay: ${delayed}`, async () => {
  const doc = parseMp4(fixture), track = doc.tracks[0]!;
  const editList = delayed ? [
    { segmentDuration: doc.timescale / 2, mediaTime: -1, mediaRateInteger: 1, mediaRateFraction: 0 },
    ...track.editList!
  ] : [];
  const bytes = serializeMp4({ ...doc, tracks: [{ ...track, editList }] });
  const source = { size: bytes.length, async read(offset: number, length: number) { return bytes.subarray(offset, offset + length); } };
  const packet = (await scanMp4Packets(source, { syncSamples }).next()).value!;
  const frame = (await scanMp4Frames(source, { syncSamples }).next()).value!;
  assert.equal(packet.pts, delayed ? 5120 : 4096);
  assert.equal(packet.dts, delayed ? 1024 : 0);
  assert.equal(frame.pts, packet.pts);
  assert.equal(frame.pkt_dts, frame.pts);
  assert.equal(frame.pkt_dts_time, frame.pts_time);
});
