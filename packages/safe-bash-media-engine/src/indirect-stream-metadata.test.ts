import { expect, it, vi } from 'vitest';
import { discover } from './discover.js';
import { createFFmpegShims } from './shim.js';
import { grammarRevision, nativeReference } from './options.generated.js';

const b = (value: string) => new TextEncoder().encode(value);

it.each(['map', 'map_metadata', 'map_chapters', 'c:a:0', 'dump_attachment:t:0'])(
  'defers stream metadata for slash-loaded %s without interpreting the option filename', key => {
    const argv = ['-i', 'input.wav', `-/${key}`, 'selected.option', 'output.mkv'].map(b);
    const plan = discover('ffmpeg', argv);
    expect(plan.argv).toEqual(argv);
    expect(plan.dependencies.map(item => [item.role, item.value])).toEqual([
      ['input', b('input.wav')], ['option-file', b('selected.option')], ['output', b('output.mkv')],
    ]);
    expect(plan.deferred).toContainEqual({ index: 2, reason: 'option-file-content' });
    expect(plan.deferred).toContainEqual({ index: 2, reason: 'stream-metadata' });
  },
);

it('leaves indirect optional and negative maps to one native invocation', async () => {
  const argv = ['-i', 'input.wav', '-/map', 'optional.option', '-/map', 'negative.option', 'output.wav'].map(b);
  const run = vi.fn(async invocation => {
    expect(invocation.argv).toEqual(argv);
    expect(invocation.discovery.deferred.filter((item: { reason: string }) => item.reason === 'stream-metadata')).toEqual([
      { index: 2, reason: 'stream-metadata' }, { index: 4, reason: 'stream-metadata' },
    ]);
    return { exitCode: 0 };
  });
  const shims = createFFmpegShims({ build: nativeReference.id, grammarRevision, argv: 'bytes', lateAccess: 'complete', effects: 'live', run });
  expect(await shims.ffmpeg(argv, {})).toEqual({ exitCode: 0 });
  expect(run).toHaveBeenCalledOnce();
});
