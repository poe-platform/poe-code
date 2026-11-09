import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { it } from 'node:test';
import { probeMp4, probeMp4Source } from './index.js';

// Native ffprobe results for AMR-NB/WB, with and without movie edit lists.
for (const band of ['nb', 'wb']) {
  for (const suffix of ['', '-flat']) {
    for (const reader of ['resident', 'source']) {
      it(`${reader} preserves AMR-${band} identity and mono layout${suffix}`, async () => {
        const bytes = readFileSync(new URL(`./fixtures/amr-${band}${suffix}.3gp`, import.meta.url));
        const probe = reader === 'resident' ? probeMp4(bytes, { showFrames: true }) : await probeMp4Source({
          size: bytes.length,
          async read(offset, length) { return bytes.subarray(offset, offset + length); }
        }, { showFrames: true });
        const streams = [];
        for await (const stream of probe.streams) {
          const { codec_name, codec_long_name, codec_tag_string, sample_rate, channels, channel_layout, bits_per_sample } = stream;
          streams.push({ codec_name, codec_long_name, codec_tag_string, sample_rate, channels, channel_layout, bits_per_sample });
        }
        assert.deepEqual(streams, [{
          codec_name: `amr_${band}`,
          codec_long_name: band === 'nb' ? 'AMR-NB (Adaptive Multi-Rate NarrowBand)' : 'AMR-WB (Adaptive Multi-Rate WideBand)',
          codec_tag_string: band === 'nb' ? 'samr' : 'sawb',
          sample_rate: band === 'nb' ? '8000' : '16000',
          channels: 1, channel_layout: 'mono', bits_per_sample: 0
        }]);
        const frames = [];
        for await (const frame of probe.frames!) frames.push({ channels: frame.channels, channel_layout: frame.channel_layout });
        assert.deepEqual(frames, Array.from({ length: band === 'nb' ? 7 : 6 }, () => ({ channels: 1, channel_layout: 'mono' })));
      });
    }
  }
}
