import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { it } from 'node:test';
import { probeMp4, probeMp4Source } from './index.js';

// Expected tags independently checked with native ffprobe on these fixtures.
for (const fixture of ['packet-positions-interleaved', 'packet-positions-faststart', 'packet-positions-fragmented', 'aac-external']) {
  for (const reader of ['resident', 'source']) {
    it(`${reader} preserves FourCC text and reports little-endian codec tags: ${fixture}`, async () => {
      const bytes = readFileSync(new URL(`./fixtures/${fixture}.mp4`, import.meta.url));
      const probe = reader === 'resident' ? probeMp4(bytes) : await probeMp4Source({
        size: bytes.length,
        async read(offset, length) { return bytes.subarray(offset, offset + length); }
      }, { syncSamples() {
        const keys = new Set<number>();
        return { add(n: number) { keys.add(n); }, has(n: number) { return keys.has(n); } };
      } });
      const tags = [];
      for await (const stream of probe.streams) tags.push([stream.codec_tag_string, stream.codec_tag]);
      assert.deepEqual(tags, fixture === 'packet-positions-faststart'
        ? [['avc1', '0x31637661']]
        : [['avc1', '0x31637661'], ['mp4a', '0x6134706d']]);
    });
  }
}
