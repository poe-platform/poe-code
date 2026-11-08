import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { MemoryFileSystem } from '@poe-code/safe-fs/core';
import { createCommandArguments } from 'safe-bash-contracts/command';
import { createFfprobeCommand } from './media.js';

for (const stdin of [false, true]) {
  it(`reports native AVI vprp stream and frame aspect ratios (stdin=${stdin})`, async () => {
    const bytes = readFileSync(new URL('../../mp4-ast/src/fixtures/vprp-wide.avi', import.meta.url));
    const fs = new MemoryFileSystem();
    await fs.writeFile('/clip.avi', bytes);
    let output = '', diagnostic = '';
    const result = await createFfprobeCommand().execute({
      command: 'ffprobe', ...createCommandArguments(['-v', 'error', '-show_frames', '-show_entries',
        'stream=width,height,sample_aspect_ratio,display_aspect_ratio:frame=width,height,sample_aspect_ratio',
        '-of', 'json', stdin ? '-' : '/clip.avi']),
      cwd: '/', env: {}, fs, signal: new AbortController().signal,
      stdin: { async *[Symbol.asyncIterator]() { yield bytes; } },
      stdout: { async write(chunk) { output += new TextDecoder().decode(chunk); } },
      stderr: { async write(chunk) { diagnostic += new TextDecoder().decode(chunk); } }
    });
    expect(result.exitCode, diagnostic).toBe(0);
    const probe = JSON.parse(output);
    const frame = { width: 64, height: 48, sample_aspect_ratio: '4:3' };
    expect(probe.frames).toEqual([frame, frame]);
    expect(probe.streams).toEqual([{ ...frame, display_aspect_ratio: '16:9' }]);
  });
}
