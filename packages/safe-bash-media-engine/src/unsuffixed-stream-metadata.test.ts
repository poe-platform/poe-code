import { expect, it, vi } from 'vitest';
import { discover } from './discover.js';
import { createFFmpegShims } from './shim.js';
import { grammarRevision, nativeReference } from './options.generated.js';

const b = (value: string) => new TextEncoder().encode(value);

it.each([
  ['passlogfile', 'logs/pass'],
  ['stats_enc_pre', 'stats.txt'],
  ['c', 'pcm_s16le'],
  ['codec', 'pcm_s16le'],
  ['copyinkf', undefined],
])('defers unsuffixed per-stream %s selection to runtime', (name, value) => {
  const argv = ['-i', 'in.wav', `-${name}`, ...(value === undefined ? [] : [value]), 'out.wav'].map(b);
  const plan = discover('ffmpeg', argv);
  expect(plan.argv).toEqual(argv);
  expect(plan.deferred).toContainEqual({ index: 2, reason: 'stream-metadata' });
});

it('keeps unsuffixed slash-loaded stream selection separate from the value-file read', async () => {
  const argv = ['-i', 'in.wav', '-/passlogfile', 'log-name.option', 'out.wav'].map(b);
  const run = vi.fn(async invocation => {
    expect(invocation.argv).toEqual(argv);
    expect(invocation.discovery.dependencies.map((item: { role: string; value: Uint8Array }) => [item.role, item.value])).toEqual([
      ['input', b('in.wav')], ['option-file', b('log-name.option')], ['output', b('out.wav')],
    ]);
    expect(invocation.discovery.deferred).toContainEqual({ index: 2, reason: 'stream-metadata' });
    expect(invocation.discovery.deferred).toContainEqual({ index: 2, reason: 'option-file-content' });
    return { exitCode: 0 };
  });
  const shims = createFFmpegShims({ build: nativeReference.id, grammarRevision, argv: 'bytes', lateAccess: 'complete', effects: 'live', run });
  expect(await shims.ffmpeg(argv, {})).toEqual({ exitCode: 0 });
  expect(run).toHaveBeenCalledOnce();
});

it('does not infer stream selection for ordinary file seek options', () => {
  const plan = discover('ffmpeg', ['-ss', '1', '-i', 'in.wav', '-ss', '2', 'out.wav'].map(b));
  expect(plan.deferred.filter(item => item.reason === 'stream-metadata')).toEqual([]);
});
