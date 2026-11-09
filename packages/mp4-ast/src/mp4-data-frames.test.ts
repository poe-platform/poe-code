import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { probeMp4, probeMp4Source } from './index.js';

const bytes = readFileSync(new URL('./fixtures/timecode-tagged.mp4', import.meta.url));

for (const route of ['resident', 'source']) test(`timecode samples remain packets without decoded frames (${route})`, async () => {
  const probe = route === 'resident' ? probeMp4(bytes, { showPackets: true, showFrames: true })
    : await probeMp4Source({ size: bytes.length,
      async read(offset, length) { return bytes.subarray(offset, offset + length); }
    }, { showPackets: true, showFrames: true, syncSamples() {
      const keys = new Set<number>();
      return { add(n: number) { keys.add(n); }, has(n: number) { return keys.has(n); } };
    } });
  const streams = [], packets = [], frames = [];
  for await (const row of probe.streams) streams.push(row);
  for await (const row of probe.packets!) packets.push(row);
  for await (const row of probe.frames!) frames.push(row);
  assert.equal(packets.filter(row => row.codec_type === 'video').length, 3);
  const data = packets.filter(row => row.codec_type === 'data');
  assert.equal(data.length, 1);
  assert.equal(data[0]!.size, '4');
  assert.deepEqual([...bytes.subarray(Number(data[0]!.pos), Number(data[0]!.pos) + 4)], [0, 1, 107, 151]);
  assert.equal(frames.filter(row => row.media_type === 'video').length, 3);
  assert.deepEqual(frames.filter(row => row.media_type === 'data'), []);
  const stream = streams.find(row => row.codec_type === 'data')!;
  assert.equal(stream.nb_frames, '1');
  assert.equal(stream.nb_read_packets, '1');
  assert.equal(stream.nb_read_frames, '0');
});
