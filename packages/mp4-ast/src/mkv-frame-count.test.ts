import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { it } from 'node:test';
import { probeMkv } from './containers/mkv.js';

it('keeps counted Matroska samples separate from declared stream metadata', () => {
  const bytes = readFileSync(new URL('./fixtures/chapters.mka', import.meta.url));
  const probe = probeMkv(bytes);
  const stream = probe.streams[0]!;
  for (const field of ['id', 'duration_ts', 'duration', 'nb_frames'] as const) {
    assert.equal(stream[field], undefined, field);
  }
  assert.equal(stream.nb_read_packets, '8');
  assert.equal(stream.nb_read_frames, '8');
  assert.equal(probe.format.duration, '1.000000');
});
