import { expect, it, vi } from 'vitest';
import { Volume } from 'memfs';

vi.mock('./discover.js', () => ({ discover: vi.fn(() => { throw new Error('Predictive grammar unavailable'); }) }));

import { createFFmpegShims } from './shim.js';
import { grammarRevision, nativeReference } from './options.generated.js';

const binding = { build: nativeReference.id, grammarRevision, argv: 'bytes' as const, lateAccess: 'complete' as const, effects: 'live' as const };

it.each(['ffmpeg', 'ffprobe'] as const)('%s reaches native late access when predictive discovery fails', async tool => {
  const fs = Volume.fromJSON({ '/late': 'canonical bytes' });
  const argv = [new TextEncoder().encode('-i'), new Uint8Array([255]), new Uint8Array()];
  const run = vi.fn(async request => {
    expect(request.argv).toEqual(argv);
    expect(request.discovery).toMatchObject({ tool, grammarRevision, dependencies: [], deferred: [{ index: -1, reason: 'native-access' }] });
    request.discovery.argv[1][0] = 0;
    expect(request.argv[1][0]).toBe(255);
    expect(request.context.fs.readFileSync('/late', 'utf8')).toBe('canonical bytes');
    fs.writeFileSync('/partial', 'native output');
    expect(() => fs.readFileSync('/missing-late')).toThrow();
    return { exitCode: 17 };
  });
  expect(await createFFmpegShims({ ...binding, run })[tool](argv, { fs })).toEqual({ exitCode: 17 });
  expect(run).toHaveBeenCalledTimes(1);
  expect(fs.readFileSync('/partial', 'utf8')).toBe('native output');
});

it('preserves remote errors after a discovery failure without retrying', async () => {
  const error = new Error('Remote authentication failed');
  const run = vi.fn(async () => { throw error; });
  await expect(createFFmpegShims({ ...binding, run }).ffmpeg([], {})).rejects.toBe(error);
  expect(run).toHaveBeenCalledTimes(1);
});
