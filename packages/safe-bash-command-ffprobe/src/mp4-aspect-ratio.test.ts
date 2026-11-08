import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { MemoryFileSystem } from '@poe-code/safe-fs/core';
import { createCommandArguments } from 'safe-bash-contracts/command';
import { createFfprobeCommand, evalSyncFfprobe } from './media.js';

// Expected fields independently checked with native ffprobe on the same bytes.
for (const [fixture, expected] of [
  ['explicit-pixel-aspect.mov', [{ width: 32, height: 24, sample_aspect_ratio: '4:3', display_aspect_ratio: '16:9' }]],
  ['aac-external.mp4', [{ width: 640, height: 360 }, {}]],
  ['packet-positions-faststart.mp4', [{ width: 32, height: 24, sample_aspect_ratio: '1:1', display_aspect_ratio: '4:3' }]]
] as const) {
  it(`preserves native aspect ratio presence through ffprobe: ${fixture}`, async () => {
    const bytes = readFileSync(new URL(`../../mp4-ast/src/fixtures/${fixture}`, import.meta.url));
    const fs = new MemoryFileSystem();
    await fs.writeFile('/clip.mp4', bytes);
    let output = '', diagnostic = '';
    const args = ['-v', 'error', '-show_entries', 'stream=width,height,sample_aspect_ratio,display_aspect_ratio', '-of', 'json', '/clip.mp4'];
    const result = await createFfprobeCommand().execute({
      command: 'ffprobe', ...createCommandArguments(args),
      cwd: '/', env: {}, fs, signal: new AbortController().signal,
      stdin: { async *[Symbol.asyncIterator]() {} },
      stdout: { async write(chunk) { output += new TextDecoder().decode(chunk); } },
      stderr: { async write(chunk) { diagnostic += new TextDecoder().decode(chunk); } }
    });
    expect(result.exitCode, diagnostic).toBe(0);
    expect(JSON.parse(output).streams).toEqual(expected);
    expect(JSON.parse(evalSyncFfprobe(undefined, args, () => bytes)!).streams).toEqual(expected);
  });
}
