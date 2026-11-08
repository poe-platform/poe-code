import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { MemoryFileSystem } from '@poe-code/safe-fs/core';
import { createCommandArguments } from 'safe-bash-contracts/command';
import { createFfprobeCommand, evalSyncFfprobe } from './media.js';

// Native fixtures: testsrc2=size=64x48:rate=2:duration=1 -vf setsar=1 -c:v libx264 -g 1;
// wide is remuxed with -c copy -aspect 16:9. Native ffprobe reports 64x48 throughout.
for (const fixture of ['pixel-square', 'pixel-wide']) {
  for (const route of ['file', 'stdin', 'stream']) {
    it(`reports pixel dimensions instead of track display dimensions: ${fixture}, ${route}`, async () => {
      const bytes = readFileSync(new URL(`./fixtures/${fixture}.mp4`, import.meta.url));
      const base = new MemoryFileSystem();
      await base.writeFile('/clip.mp4', bytes);
      const capabilities = { ...base.capabilities, retainedRead: false, streamingRead: true };
      const fs = route === 'stream' ? new Proxy(base, { get(target, key) {
        if (key === 'capabilities') return capabilities;
        if (key === 'capabilitiesFor') return async () => capabilities;
        const value = Reflect.get(target, key, target);
        return typeof value === 'function' ? value.bind(target) : value;
      } }) : base;
      const args = ['-v', 'error', '-show_frames', '-show_entries',
        'stream=width,height:frame=width,height', '-of', 'json', route === 'stdin' ? '-' : '/clip.mp4'];
      let output = '', diagnostic = '';
      const result = await createFfprobeCommand().execute({
        command: 'ffprobe', ...createCommandArguments(args), cwd: '/', env: {}, fs,
        signal: new AbortController().signal,
        stdin: { async *[Symbol.asyncIterator]() { yield bytes; } },
        stdout: { async write(chunk) { output += new TextDecoder().decode(chunk); } },
        stderr: { async write(chunk) { diagnostic += new TextDecoder().decode(chunk); } }
      });
      expect(result.exitCode, diagnostic).toBe(0);
      const outputs = [output];
      if (route === 'file') outputs.push(evalSyncFfprobe(undefined, args, () => bytes)!);
      for (const text of outputs) {
        const probe = JSON.parse(text);
        expect(probe.streams).toEqual([{ width: 64, height: 48 }]);
        expect(probe.frames).toEqual([{ width: 64, height: 48 }, { width: 64, height: 48 }]);
      }
    });
  }
}
