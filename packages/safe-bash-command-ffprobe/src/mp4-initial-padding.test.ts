import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { MemoryFileSystem } from '@poe-code/safe-fs/core';
import { createCommandArguments } from 'safe-bash-contracts/command';
import { createFfprobeCommand } from './media.js';

for (const [fixture, padding] of [
  ['aac-external', 1024], ['packet-positions-fragmented', 0]
] as const) {
  for (const selected of [false, true]) it(`reports AAC initial padding through ffprobe: ${fixture}, selected=${selected}`, async () => {
    const bytes = readFileSync(new URL(`../../mp4-ast/src/fixtures/${fixture}.mp4`, import.meta.url));
    const fs = new MemoryFileSystem();
    await fs.writeFile('/clip.mp4', bytes);
    let output = '', diagnostic = '';
    const result = await createFfprobeCommand().execute({
      command: 'ffprobe', ...createCommandArguments(['-v', 'error', ...(selected ? ['-show_entries', 'stream=index,initial_padding'] : ['-show_streams']), '-of', 'json', '/clip.mp4']),
      cwd: '/', env: {}, fs, signal: new AbortController().signal,
      stdin: { async *[Symbol.asyncIterator]() {} },
      stdout: { async write(chunk) { output += new TextDecoder().decode(chunk); } },
      stderr: { async write(chunk) { diagnostic += new TextDecoder().decode(chunk); } }
    });
    expect(result.exitCode, diagnostic).toBe(0);
    const streams = JSON.parse(output).streams;
    expect(streams[0]).not.toHaveProperty('initial_padding');
    expect(streams[1]).toMatchObject({ index: 1, initial_padding: padding });
    if (selected) expect(streams).toEqual([{ index: 0 }, { index: 1, initial_padding: padding }]);
  });
}
