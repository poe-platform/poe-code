import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { probeMp4 } from '@poe-code/mp4-ast';
import { MemoryFileSystem } from '@poe-code/safe-fs/core';
import { createCommandArguments } from 'safe-bash-contracts/command';
import { createFfprobeCommand, evalSyncFfprobe } from './media.js';

for (const rotation of [45, -45]) it(`reports the original ${rotation} degree MP4 matrix through all probe routes`, async () => {
  const bytes = readFileSync(new URL(`../../safe-bash-command-ffmpeg/src/fixtures/rotation-${rotation === 45 ? "45" : "minus-45"}.mp4`, import.meta.url));
  const displaymatrix = rotation === 45
    ? "\n00000000:        46341      -46341           0\n00000001:        46341       46341           0\n00000002:            0           0  1073741824\n"
    : "\n00000000:        46341       46341           0\n00000001:       -46341       46341           0\n00000002:            0           0  1073741824\n";
  const expected = [{ side_data_type: 'Display Matrix', displaymatrix, rotation }];
  expect(probeMp4(bytes).streams[0]?.side_data_list).toEqual(expected);
  const fs = new MemoryFileSystem();
  await fs.writeFile('/input.mp4', bytes);
  for (const target of ['/input.mp4', '-']) for (const selection of [
    ['-show_streams'], ['-show_entries', 'stream=index:stream_side_data=side_data_type,displaymatrix,rotation']
  ]) {
    const args = ['-v', 'error', ...selection, '-of', 'json', target];
    let output = '';
    const result = await createFfprobeCommand().execute({
      command: 'ffprobe', ...createCommandArguments(args), cwd: '/', env: {}, fs,
      signal: new AbortController().signal,
      stdin: { async *[Symbol.asyncIterator]() { yield bytes; } },
      stdout: { async write(chunk) { output += new TextDecoder().decode(chunk); } },
      stderr: { async write(chunk) { throw new Error(new TextDecoder().decode(chunk)); } }
    });
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(output).streams[0].side_data_list).toEqual(expected);
    expect(JSON.parse(evalSyncFfprobe(target === '-' ? bytes : undefined, args, () => bytes)!).streams[0].side_data_list).toEqual(expected);
  }
});
