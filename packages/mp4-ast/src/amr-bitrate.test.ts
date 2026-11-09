import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { it } from 'node:test';
import { probeMp4, probeMp4Source } from './index.js';

// Native ffprobe rates use untrimmed media ticks, including encoder lead-in.
for (const [fixture, ticks, timescale, bitrate] of [
  ['nb', 960, 8000, '14194'], ['nb-flat', 1010, 8000, '14194'],
  ['wb', 1840, 16000, '24400'], ['wb-flat', 1920, 16000, '24400']
] as const) {
  for (const reader of ['resident', 'source']) {
    it(`${reader} preserves AMR bitrate and presentation duration: ${fixture}`, async () => {
      const bytes = readFileSync(new URL(`./fixtures/amr-bitrate-${fixture}.3gp`, import.meta.url));
      const probe = reader === 'resident' ? probeMp4(bytes, { decodeAudio: false }) : await probeMp4Source({
        size: bytes.length,
        async read(offset, length) { return bytes.subarray(offset, offset + length); }
      });
      const streams = [];
      for await (const stream of probe.streams) streams.push({
        bit_rate: stream.bit_rate, duration_ts: stream.duration_ts, time_base: stream.time_base
      });
      assert.deepEqual(streams, [{ bit_rate: bitrate, duration_ts: ticks, time_base: `1/${timescale}` }]);
    });
  }
}
