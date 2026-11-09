import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { MemoryFileSystem } from '@poe-code/safe-fs/core';
import { createCommandArguments } from 'safe-bash-contracts/command';
import { createFfprobeCommand } from './media.js';

for (const [fixture, ticks, timescale, bitrate] of [
  ['nb', 960, 8000, '14194'], ['nb-flat', 1010, 8000, '14194'],
  ['wb', 1840, 16000, '24400'], ['wb-flat', 1920, 16000, '24400']
] as const) {
  it(`reports AMR bitrate independently of presentation trimming through ffprobe: ${fixture}`, async () => {
    const bytes = readFileSync(new URL(`../../mp4-ast/src/fixtures/amr-bitrate-${fixture}.3gp`, import.meta.url));
    const fs = new MemoryFileSystem();
    await fs.writeFile('/clip.mp4', bytes);
    let output = '', diagnostic = '';
    const result = await createFfprobeCommand().execute({
      command: 'ffprobe', ...createCommandArguments(['-v', 'error', '-show_entries', 'stream=bit_rate,duration_ts,time_base:packet=size,duration', '-of', 'json', '/clip.mp4']),
      cwd: '/', env: {}, fs, signal: new AbortController().signal,
      stdin: { async *[Symbol.asyncIterator]() {} },
      stdout: { async write(chunk) { output += new TextDecoder().decode(chunk); } },
      stderr: { async write(chunk) { diagnostic += new TextDecoder().decode(chunk); } }
    });
    expect(result.exitCode, diagnostic).toBe(0);
    const probe = JSON.parse(output);
    expect(probe.packets).toMatchObject(timescale === 8000
      ? [...Array.from({ length: 6 }, () => ({ size: '32', duration: 160 })), { size: '32', duration: 50 }]
      : Array.from({ length: 6 }, () => ({ size: '61', duration: 320 })));
    expect(probe.streams).toEqual([
      { bit_rate: bitrate, duration_ts: ticks, time_base: `1/${timescale}` }
    ]);
  });
}
