import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { MemoryFileSystem } from '@poe-code/safe-fs/core';
import { createCommandArguments } from 'safe-bash-contracts/command';
import { createFfprobeCommand } from './media.js';

// Native ffprobe results for the unchanged three-frame H.264 fixtures.
it.each([
  ['drop', '319'],
  ['tagged', '266']
])('reports exact timecode stream bitrate: %s', async (fixture, bitrate) => {
  const fs = new MemoryFileSystem();
  await fs.writeFile('/clip.mp4', readFileSync(new URL(`../../mp4-ast/src/fixtures/timecode-${fixture}.mp4`, import.meta.url)));
  let output = '', diagnostic = '';
  const result = await createFfprobeCommand().execute({
    command: 'ffprobe', ...createCommandArguments(['-v', 'error', '-select_streams', '1',
      '-show_entries', 'stream=r_frame_rate,avg_frame_rate,bit_rate', '-of', 'json', '/clip.mp4']),
    cwd: '/', env: {}, fs, signal: new AbortController().signal,
    stdin: { async *[Symbol.asyncIterator]() {} },
    stdout: { async write(chunk) { output += new TextDecoder().decode(chunk); } },
    stderr: { async write(chunk) { diagnostic += new TextDecoder().decode(chunk); } }
  });
  expect(result.exitCode, diagnostic).toBe(0);
  expect(diagnostic).toBe('');
  expect(JSON.parse(output).streams).toMatchObject([{ r_frame_rate: '0/0', bit_rate: bitrate }]);
});
