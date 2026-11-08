import { expect, it } from 'vitest';
import { createReadStream } from 'node:fs';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { discoverImageMagick } from '../src/imagemagick.js';
import { imageMagickReference } from '../src/imagemagick.generated.js';
import { runNative } from './runner.js';

// These PPM/list/script checks need no fonts. Verify the invoked binary without
// claiming qualification of the broader host font/configuration inventory.
it.each(['list', 'script', 'script-budget'])('preserves native %s expansion with seven-byte discovery chunks', async kind => {
  const executable = imageMagickReference.executables.magick;
  expect(createHash('sha256').update(await readFile(executable.path)).digest('hex')).toBe(executable.sha256);
  const cwd = await mkdtemp(join(tmpdir(), 'media-discovery-'));
  const b = (s: string) => new TextEncoder().encode(s);
  try {
    await writeFile(join(cwd, 'one file.ppm'), 'P3\n1 1\n255\n255 0 0\n');
    await writeFile(join(cwd, 'input'), kind === 'list' ? "'one file.ppm'"
      : kind === 'script-budget' ? '"one file.ppm" -set comment "' + 'x'.repeat(65537) + '" -strip -write out.ppm'
      : '"one file.ppm" -write out.ppm');
    const args = (kind === 'list' ? ['@input', 'out.ppm'] : ['-script', 'input']).map(b);
    const context = {
      accessible: async (path: Uint8Array) => { try { return (await stat(join(cwd, new TextDecoder().decode(path)))).isFile(); } catch { return false; } },
      isDirectory: async () => false,
      readStream: (path: Uint8Array) => createReadStream(join(cwd, new TextDecoder().decode(path)), { highWaterMark: 7 }),
    };
    const discovery = await discoverImageMagick('magick', args, context);
    expect(discovery.resources.some(resource => new TextDecoder().decode(resource.path) === 'one file.ppm')).toBe(true);
    if (kind === 'script-budget') expect(discovery.deferred.some(entry => entry.reason.includes('prediction budget'))).toBe(true);
    const nativeContext = { cwd, env: { PATH: '/usr/bin:/bin', MAGICK_THREAD_LIMIT: '1' }, stdin: new Uint8Array() };
    expect((await runNative(executable.path, discovery.argv, nativeContext)).exitCode).toBe(0);
    const result = await readFile(join(cwd, 'out.ppm'));
    expect((await runNative(executable.path, ['one file.ppm', 'direct.ppm'].map(b), nativeContext)).exitCode).toBe(0);
    expect(result).toEqual(await readFile(join(cwd, 'direct.ppm')));
  } finally { await rm(cwd, { recursive: true, force: true }); }
});
