import { expect, it } from 'vitest';
import { discover } from './discover.js';

const b = (value: string) => new TextEncoder().encode(value);

it.each(['ffmpeg', 'ffprobe'] as const)('defers unsuffixed %s codec dictionary matching without probing', tool => {
  const argv = ['-threads', '1', '-thread_type', 'slice', '-i', 'source.wav'].map(b);
  const plan = discover(tool, argv);
  expect(plan.dependencies.map(({ role, value }) => [role, value])).toEqual([
    ['input', b('source.wav')],
  ]);
  expect(plan.deferred).toContainEqual({ index: 0, reason: 'stream-metadata' });
  expect(plan.deferred).toContainEqual({ index: 2, reason: 'stream-metadata' });
  expect(plan.argv).toEqual(argv);
});

it('keeps non-codec private options separate from codec stream matching', () => {
  const plan = discover('ffmpeg', ['-safe', '0', '-f', 'concat', '-i', 'list.ffconcat'].map(b));
  expect(plan.deferred).not.toContainEqual({ index: 0, reason: 'stream-metadata' });
});
