import { expect, it } from 'vitest';
import { createWorkerShell } from '../deploy/composition.js';
import { MemoryFileSystem } from '@poe-platform/safe-bash';
it('requires an explicit canonical filesystem', () => {
  expect(() => createWorkerShell({ engine: { execute: async () => ({ exitCode: 0 }) } } as never)).toThrow('canonical');
});
it('preserves binary pipes and canonical file effects', async () => {
  const fs = new MemoryFileSystem();
  const bytes = Uint8Array.from({ length: 256 }, (_, i) => i);
  const shell = createWorkerShell({ fs, engine: { async execute(request) {
    expect(request.fs).toBeDefined();
    expect(request.args[0]).toEqual(new TextEncoder().encode('-version'));
    if (request.command === 'ffmpeg') {
      await request.stdout.write(bytes);
    } else {
      const incoming: number[] = [];
      for await (const chunk of request.stdin) {
        incoming.push(...chunk);
        await request.stdout.write(chunk);
      }
      expect(new Uint8Array(incoming)).toEqual(bytes);
    }
    return { exitCode: 0 };
  } } });
  const result = await shell.exec('ffmpeg -version | ffprobe -version > /result');
  expect(result.exitCode).toBe(0);
  expect(await fs.readFile('/result')).toEqual(bytes);
  await shell.dispose();
});
it('registers pinned media executables without exposing build helpers', async () => {
  const shell = createWorkerShell({ fs: new MemoryFileSystem(), engine: { execute: async () => ({ exitCode: 0 }) } });
  expect((await shell.exec('identify -version')).exitCode).toBe(0);
  expect(shell.commands.has('identify')).toBe(true);
  expect(shell.commands.has('MagickCore-config')).toBe(false);
  await shell.dispose();
});
