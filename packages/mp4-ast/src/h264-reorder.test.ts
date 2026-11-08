import assert from 'node:assert/strict';
import { it } from 'node:test';
import { buildAvcC, buildH264SpsPps, parseAvcC, parseH264Sps } from './codecs.js';
import { createSyntheticMp4, parseMp4, probeMp4, probeMp4Source, serializeMp4 } from './index.js';

// SPS bytes from native libx264 clips; ffprobe reports reorder depths 0, 1, 2.
// The final sample includes nal-hrd=cbr timing before the restriction fields.
const sequences = [
  [0, 'Z2QACqyyCPYCIAAAAwAgAAADAoHiRMk='],
  [1, 'Z2QACqzkEewEQAAAAwBAAAAFA8SJRIA='],
  [2, 'Z2QACqzZRHsBEAAAAwAQAAADAUDxIllg'],
  [2, 'Z2QACazZRHsBEAAAAwAQAAADAUYEAGGgAYa5rKAeJEss']
] as const;

it('reads H.264 maximum reorder depth after optional HRD parameters', () => {
  for (const [expected, encoded] of sequences) {
    const sps = parseH264Sps(Buffer.from(encoded, 'base64'));
    assert.equal(sps.maxNumReorderFrames, expected);
    assert.equal(sps.fps, 10);
    assert.equal(sps.width, 64);
    assert.equal(sps.height, 48);
  }
  assert.equal(parseH264Sps(buildH264SpsPps(16, 16).sps).maxNumReorderFrames, undefined);
});

for (const reader of ['resident', 'source']) {
  it(`${reader} probes use codec reorder depth without mistaking a fixed delay for reordering`, async () => {
    const base = parseMp4(createSyntheticMp4({ width: 64, height: 48, frameCount: 3, includeAudio: false }));
    const track = base.tracks[0]!, description = track.codecDescriptions[0]!;
    for (const offset of [0, 9000]) {
      for (const [expected, encoded] of [...sequences, [undefined, undefined]] as const) {
        const avcC = encoded ? parseAvcC(buildAvcC([Buffer.from(encoded, 'base64')], description.avcC!.pps)) : description.avcC;
        const bytes = serializeMp4({ ...base, tracks: [{ ...track,
          codecDescriptions: [{ ...description, avcC, rawStsdEntryBytes: undefined }],
          samples: track.samples.map(sample => ({ ...sample, pts: sample.pts + offset, cts: sample.cts + offset }))
        }] });
        const probe = reader === 'resident' ? probeMp4(bytes) : await probeMp4Source({
          size: bytes.length,
          async read(start, length) { assert.ok(length <= 16384); return bytes.slice(start, start + Math.min(length, 31)); }
        }, { syncSamples() { const keys = new Set<number>(); return { add(n: number) { keys.add(n); }, has(n: number) { return keys.has(n); } }; } });
        let count = 0;
        for await (const stream of probe.streams) {
          assert.equal(stream.has_b_frames, expected ?? 0, `depth ${expected}, offset ${offset}`);
          count++;
        }
        assert.equal(count, 1);
      }
    }
  });

  it(`${reader} probes infer reordering from presentation order when codec depth is absent`, async () => {
    const base = parseMp4(createSyntheticMp4({ width: 64, height: 48, frameCount: 3, includeAudio: false }));
    const track = base.tracks[0]!;
    for (const [expected, times] of [[0, [0, 9000, 18000]], [0, [9000, 18000, 27000]], [0, [0, 18000, 27000]], [1, [0, 18000, 9000]]] as const) {
      const bytes = serializeMp4({ ...base, tracks: [{ ...track,
        samples: track.samples.map((sample, i) => ({ ...sample, pts: times[i]!, cts: times[i]! - sample.dts }))
      }] });
      const probe = reader === 'resident' ? probeMp4(bytes) : await probeMp4Source({
        size: bytes.length,
        async read(start, length) { return bytes.slice(start, start + Math.min(length, 31)); }
      }, { syncSamples() { const keys = new Set<number>(); return { add(n: number) { keys.add(n); }, has(n: number) { return keys.has(n); } }; } });
      for await (const stream of probe.streams) assert.equal(stream.has_b_frames, expected, `presentation times ${times}`);
    }
  });
}
