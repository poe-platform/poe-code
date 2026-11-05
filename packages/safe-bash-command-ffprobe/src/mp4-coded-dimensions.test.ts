import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { MemoryFileSystem } from '@poe-code/safe-fs/core';
import { createCommandArguments } from 'safe-bash-contracts/command';
import { createFfprobeCommand } from './media.js';

for (const [fixture, width, height] of [
  ['packet-positions-faststart', 32, 24],
  ['packet-positions-interleaved', 32, 24],
  ['packet-positions-fragmented', 32, 24],
  ['h264-edit-list', 32, 24],
  ['aac-external', 640, 360]
] as const) {
  it(`reports native cropped H.264 dimensions through ffprobe: ${fixture}`, async () => {
    const bytes = readFileSync(new URL(`../../mp4-ast/src/fixtures/${fixture}.mp4`, import.meta.url));
    const fs = new MemoryFileSystem();
    await fs.writeFile('/clip.mp4', bytes);
    let output = '', diagnostic = '';
    const result = await createFfprobeCommand().execute({
      command: 'ffprobe', ...createCommandArguments(['-v', 'error', '-select_streams', 'v', '-show_entries', 'stream=index,width,height,coded_width,coded_height', '-of', 'json', '/clip.mp4']),
      cwd: '/', env: {}, fs, signal: new AbortController().signal,
      stdin: { async *[Symbol.asyncIterator]() {} },
      stdout: { async write(chunk) { output += new TextDecoder().decode(chunk); } },
      stderr: { async write(chunk) { diagnostic += new TextDecoder().decode(chunk); } }
    });
    expect(result.exitCode, diagnostic).toBe(0);
    expect(JSON.parse(output).streams).toEqual([{ index: 0, width, height, coded_width: width, coded_height: height }]);
  });
}
