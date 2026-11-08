import assert from 'node:assert/strict';
import { it } from 'node:test';
import { buildAvcC, parseAvcC } from './codecs.js';
import { createSyntheticMp4, parseMp4, probeMp4, probeMp4Source, serializeMp4 } from './index.js';

for (const reader of ['resident', 'source']) {
  it(`${reader} probes preserve signaled H.264 chroma location, bit depth and NAL length`, async () => {
    const base = parseMp4(createSyntheticMp4({ width: 64, height: 48, frameCount: 1, includeAudio: false }));
    const track = base.tracks[0]!, description = track.codecDescriptions[0]!;
    // Native libx264 10-bit SPS with center chroma; independently checked with ffprobe.
    const sps = Buffer.from('Z24ACqbNlEewEpQAAAMABAAAAwAIPEiWWA==', 'base64');
    for (const lengthSizeMinusOne of [0, 1, 3]) {
      const config = buildAvcC([sps], description.avcC!.pps);
      config[4] = 0xfc | lengthSizeMinusOne;
      const avcC = parseAvcC(config);
      const bytes = serializeMp4({ ...base, tracks: [{ ...track,
        codecDescriptions: [{ ...description, avcC, rawStsdEntryBytes: undefined }]
      }] });
      const probe = reader === 'resident' ? probeMp4(bytes) : await probeMp4Source({
        size: bytes.length,
        async read(start, length) { return bytes.slice(start, start + Math.min(length, 31)); }
      }, { syncSamples() { const keys = new Set<number>(); return { add(n: number) { keys.add(n); }, has(n: number) { return keys.has(n); } }; } });
      let count = 0;
      for await (const stream of probe.streams) {
        assert.equal(stream.chroma_location, 'center');
        assert.equal(stream.bits_per_raw_sample, '10');
        assert.equal(stream.is_avc, 'true');
        assert.equal(stream.nal_length_size, String(lengthSizeMinusOne + 1));
        count++;
      }
      assert.equal(count, 1);
    }
  });
}
