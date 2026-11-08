import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { probeMp4 } from '@poe-code/mp4-ast';
import { MemoryFileSystem } from '@poe-code/safe-fs/core';
import { createCommandArguments } from 'safe-bash-contracts/command';
import { createFfprobeCommand } from './media.js';

// Native FFmpeg: testsrc2=size=64x48:rate=2:duration=1 -vf setsar=1 -c:v libx264 -g 1.
// The wide fixture is a stream-copy remux with -aspect 16:9; native ffprobe reports 4:3.
for (const [fixture, sar] of [['square', '1:1'], ['wide', '4:3']] as const) {
  for (const route of ['buffered', 'file', 'stdin'] as const) {
    it(`reports declared frame SAR for ${fixture} via ${route}`, async () => {
      const bytes = readFileSync(new URL(`./fixtures/frame-sar-${fixture}.mp4`, import.meta.url));
      const expected = Array.from({ length: 2 }, () => ({ width: 64, height: 48, sample_aspect_ratio: sar }));
      if (route === 'buffered') {
        const probe = probeMp4(bytes, { showFrames: true });
        expect(probe.frames?.map(({ width, height, sample_aspect_ratio }) => ({ width, height, sample_aspect_ratio }))).toEqual(expected);
        return;
      }
      const fs = new MemoryFileSystem();
      await fs.writeFile('/clip.mp4', bytes);
      let output = '', diagnostic = '';
      const result = await createFfprobeCommand().execute({
        command: 'ffprobe', ...createCommandArguments(['-v', 'error', '-show_frames', '-show_entries',
          'stream=width,height,sample_aspect_ratio,display_aspect_ratio:frame=width,height,sample_aspect_ratio',
          '-of', 'json', route === 'stdin' ? '-' : '/clip.mp4']),
        cwd: '/', env: {}, fs, signal: new AbortController().signal,
        stdin: { async *[Symbol.asyncIterator]() { yield bytes; } },
        stdout: { async write(chunk) { output += new TextDecoder().decode(chunk); } },
        stderr: { async write(chunk) { diagnostic += new TextDecoder().decode(chunk); } }
      });
      expect(result.exitCode, diagnostic).toBe(0);
      const probe = JSON.parse(output);
      expect(probe.frames).toEqual(expected);
      expect(probe.streams).toEqual([{ ...expected[0], display_aspect_ratio: fixture === 'square' ? '4:3' : '16:9' }]);
    });
  }
}
