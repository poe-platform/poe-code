import { expect, it, vi } from 'vitest';
import { discover } from './discover.js';
import { createFFmpegShims } from './shim.js';
import { grammarRevision, nativeReference } from './options.generated.js';

const b = (value: string) => new TextEncoder().encode(value);

it('defers an indirect attachment filename that may be empty without reading its option file', () => {
  const argv = ['-/dump_attachment', 'name.option', '-i', 'attachments.mkv', '-f', 'null', '-'].map(b);
  const plan = discover('ffmpeg', argv);
  expect(plan.dependencies.map(item => [item.role, item.value])).toEqual([
    ['option-file', b('name.option')], ['input', b('attachments.mkv')], ['output', b('-')],
  ]);
  expect(plan.deferred).toContainEqual({ index: 0, reason: 'stream-metadata' });
  expect(plan.deferred).toContainEqual({ index: 0, reason: 'option-file-content' });
});

it.each(['dump_attachment', 'dump_attachment:t:0'])(
  'defers the metadata filename of an empty %s without predicting an empty file', name => {
    const argv = [`-${name}`, '', '-i', 'attachments.mkv', '-f', 'null', '-'].map(b);
    const plan = discover('ffmpeg', argv);
    expect(plan.dependencies.map(item => [item.role, item.value])).toEqual([
      ['input', b('attachments.mkv')], ['output', b('-')],
    ]);
    expect(plan.deferred.filter(item => item.reason === 'stream-metadata')).toEqual([
      { index: 0, reason: 'stream-metadata' },
    ]);
    expect(plan.argv).toEqual(argv);
  },
);

it('keeps attachment metadata discovery inside the single native execution', async () => {
  const argv = ['-dump_attachment', '', '-i', 'attachments.mkv', '-f', 'null', '-'].map(b);
  const run = vi.fn(async invocation => {
    expect(invocation.argv).toEqual(argv);
    expect(invocation.discovery.deferred).toContainEqual({ index: 0, reason: 'stream-metadata' });
    return { exitCode: 1 };
  });
  expect(await createFFmpegShims({ build: nativeReference.id, grammarRevision,
    argv: 'bytes', lateAccess: 'complete', effects: 'live', run }).ffmpeg(argv, {}))
    .toEqual({ exitCode: 1 });
  expect(run).toHaveBeenCalledOnce();
});
