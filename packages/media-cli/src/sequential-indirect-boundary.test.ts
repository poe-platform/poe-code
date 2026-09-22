import { expect, it, vi } from 'vitest';
import { Volume } from 'memfs';
import { discover } from './discover.js';
import { discoverContent } from './content.js';
import { createFFmpegShims } from './shim.js';
import { grammarRevision, nativeReference } from './options.generated.js';

const b = (value: string) => new TextEncoder().encode(value);

it('retains an unknown sequential option-file read and defers subsequent operands', () => {
  const argv = ['-/future_private_option', 'value.option', '-i', 'late.wav', '-o', 'late.json'].map(b);
  const plan = discover('ffprobe', argv);
  expect(plan.argv).toEqual(argv);
  expect(plan.dependencies.map(item => [item.role, item.value])).toEqual([
    ['option-file', b('value.option')],
  ]);
  expect(plan.deferred).toContainEqual({ index: 0, reason: 'unknown-option' });
  expect(plan.deferred).toContainEqual({ index: -1, reason: 'native-access' });
});

it('stops preset predictions after reading an unregistered indirect option', () => {
  const plan = discoverContent({ kind: 'preset', location: b('command.ffpreset'),
    content: b('attach=before.wav\n/future_private_option=value.option\nattach=late.wav\n') });
  expect(plan.dependencies.map(item => [item.role, item.value])).toEqual([
    ['attachment', b('before.wav')], ['option-file', b('value.option')],
  ]);
});

it('continues after registered sequential indirect AVOptions without reading their values', () => {
  const plan = discover('ffprobe', ['-/probesize', 'size.option', '-i', 'source.wav'].map(b));
  expect(plan.dependencies.map(item => item.value)).toEqual([b('size.option'), b('source.wav')]);
  expect(plan.deferred.some(item => item.reason === 'unknown-option')).toBe(false);
});

it('lets the binding accept an inventory miss and read later resources once at runtime', async () => {
  const fs = Volume.fromJSON({ '/value.option': 'native-supported value', '/late.wav': 'native input' });
  const argv = ['-/future_private_option', 'value.option', '-i', 'late.wav', '-o', 'late.json'].map(b);
  const run = vi.fn(async request => {
    expect(request.argv).toEqual(argv);
    expect(request.discovery.dependencies.map((item: { value: Uint8Array }) => item.value)).toEqual([b('value.option')]);
    // A future native-valid option may succeed despite an inventory miss.
    // The binding retains access to every actual resource, including the output.
    expect(request.context.fs.readFileSync('/value.option', 'utf8')).toBe('native-supported value');
    fs.writeFileSync('/late.json', fs.readFileSync('/late.wav'));
    return { exitCode: 0 };
  });
  const shim = createFFmpegShims({ build: nativeReference.id, grammarRevision,
    argv: 'bytes', lateAccess: 'complete', effects: 'live', run }).ffprobe;
  expect(await shim(argv, { fs })).toEqual({ exitCode: 0 });
  expect(run).toHaveBeenCalledOnce();
  expect(fs.readFileSync('/late.json', 'utf8')).toBe('native input');
});
