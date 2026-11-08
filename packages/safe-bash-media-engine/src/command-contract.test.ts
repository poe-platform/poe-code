import { expect, it, vi } from 'vitest';
import { discover } from './discover.js';
import { createFFmpegShims } from './shim.js';
import { grammarRevision, nativeReference } from './options.generated.js';

const b = (value: string) => new TextEncoder().encode(value);

it('predicts dependencies independently of seek placement, maps and per-output codecs', async () => {
  const argv = ['-y', '-n', '-y', '-ss', '0.1', '-i', '-source.mkv',
    '-ss', '0.2', '-map', '0:v?', '-map', '-0:a', '-c:v:0', 'rawvideo', 'first.nut',
    '-c:a', 'pcm_s16le', '-map', '0:a?', 'second.wav'].map(b);
  const plan = discover('ffmpeg', argv);
  expect(plan.dependencies.map(({ role, value, access }) => [role, value, access])).toEqual([
    ['input', b('-source.mkv'), 'read'], ['output', b('first.nut'), 'write'],
    ['output', b('second.wav'), 'write'],
  ]);
  expect(plan.globals.map(option => option.name)).toEqual(['y', 'n', 'y']);
  expect(plan.groups.map(group => [group.kind, group.options.map(option => [option.name, option.value])])).toEqual([
    ['input', [['ss', b('0.1')]]],
    ['output', [['ss', b('0.2')], ['map', b('0:v?')], ['map', b('-0:a')], ['c', b('rawvideo')]]],
    ['output', [['c', b('pcm_s16le')], ['map', b('0:a?')]]],
  ]);
  expect(plan.deferred).toContainEqual({ index: 9, reason: 'stream-metadata' });
  expect(plan.deferred).toContainEqual({ index: 11, reason: 'stream-metadata' });
  const run = vi.fn(async invocation => {
    expect(invocation.argv).toEqual(argv);
    return { exitCode: 1 }; // Native owns the conflicting overwrite flags.
  });
  expect(await createFFmpegShims({ build: nativeReference.id, grammarRevision,
    argv: 'bytes', lateAccess: 'complete', effects: 'live', run }).ffmpeg(argv, {})).toEqual({ exitCode: 1 });
  expect(run).toHaveBeenCalledOnce();
});

it.each(['ffmpeg', 'ffprobe'] as const)('preserves empty, raw and already shell-expanded %s operands', async tool => {
  const raw = Uint8Array.of(255, 128, 46, 119, 97, 118);
  const argv = [b('-i'), raw, b('-metadata'), b('title=two words $HOME *.wav'), b('')];
  const plan = discover(tool, argv);
  expect(plan.argv).toEqual(argv);
  expect(plan.dependencies[0].value).toEqual(raw);
  const run = vi.fn(async invocation => {
    expect(invocation.argv).toEqual(argv);
    expect(invocation.discovery.deferred).toContainEqual({ index: -1, reason: 'native-access' });
    return { exitCode: 17 };
  });
  expect(await createFFmpegShims({ build: nativeReference.id, grammarRevision,
    argv: 'bytes', lateAccess: 'complete', effects: 'live', run })[tool](argv, {})).toEqual({ exitCode: 17 });
  expect(run).toHaveBeenCalledOnce();
});
