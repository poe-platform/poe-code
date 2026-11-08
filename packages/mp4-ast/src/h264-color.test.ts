import assert from 'node:assert/strict';
import { it } from 'node:test';
import { buildAvcC, buildH264SpsPps, parseAvcC, parseH264Sps } from './codecs.js';
import { createSyntheticMp4, parseMp4, probeMp4, probeMp4Source, serializeMp4 } from './index.js';

// Native libx264 SPS fixtures; expected fields independently checked with ffprobe.
const sequences = [
  ['pc', 'bt709', 'Z2QACqzZRHsBbgQEAoAAAAMAgAAACgeJEss='],
  ['tv', 'smpte170m', 'Z2QACqzZRHsBagQEDIAAAAMAgAAACgeJEss='],
  ['pc', 'bt2020nc', 'Z2QACqzZRHsBbgQEEoAAAAMAgAAACgeJEss='],
  ['pc', undefined, 'Z2QACqzZRHsBbIAAAAMAgAAACgeJEss='],
  [undefined, undefined, undefined]
] as const;

it('reads signaled H.264 color range and matrix without inventing absent metadata', () => {
  for (const [range, space, encoded] of sequences) {
    const sps = parseH264Sps(encoded ? Buffer.from(encoded, 'base64') : buildH264SpsPps(64, 48).sps);
    assert.equal(sps.colorRange, range);
    assert.equal(sps.colorSpace, space);
  }
});

for (const reader of ['resident', 'source']) {
  it(`${reader} stream probes preserve H.264 color metadata`, async () => {
    const base = parseMp4(createSyntheticMp4({ width: 64, height: 48, frameCount: 3, includeAudio: false }));
    const track = base.tracks[0]!, description = track.codecDescriptions[0]!;
    for (const [range, space, encoded] of sequences) {
      const avcC = encoded ? parseAvcC(buildAvcC([Buffer.from(encoded, 'base64')], description.avcC!.pps)) : description.avcC;
      const bytes = serializeMp4({ ...base, tracks: [{ ...track,
        codecDescriptions: [{ ...description, avcC, rawStsdEntryBytes: undefined }]
      }] });
      const probe = reader === 'resident' ? probeMp4(bytes) : await probeMp4Source({
        size: bytes.length,
        async read(start, length) { assert.ok(length <= 16384); return bytes.slice(start, start + Math.min(length, 31)); }
      }, { syncSamples() { const keys = new Set<number>(); return { add(n: number) { keys.add(n); }, has(n: number) { return keys.has(n); } }; } });
      let count = 0;
      for await (const stream of probe.streams) {
        assert.equal(stream.color_range, range);
        assert.equal(stream.color_space, space);
        count++;
      }
      assert.equal(count, 1);
    }
  });
}
