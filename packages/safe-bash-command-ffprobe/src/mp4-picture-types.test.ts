import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { MemoryFileSystem } from '@poe-code/safe-fs/core';
import { createCommandArguments } from 'safe-bash-contracts/command';
import { createFfprobeCommand } from './media.js';

for (const mixed of [false, true]) it(`omits unknown MP4 picture types, mixed=${mixed}`, async () => {
  const fs = new MemoryFileSystem();
  await fs.writeFile('/input.mp4', readFileSync(new URL('../../mp4-ast/src/fixtures/h264-picture-types.mp4', import.meta.url)));
  let output = '', diagnostic = '';
  const result = await createFfprobeCommand().execute({
    command: 'ffprobe',
    ...createCommandArguments(['-v', 'error', '-select_streams', 'v:0', '-show_frames',
      ...(mixed ? ['-show_packets'] : []), '-show_entries', 'frame=pict_type,key_frame,pts', '-of', 'json', '/input.mp4']),
    cwd: '/', env: {}, fs, signal: new AbortController().signal,
    stdin: { async *[Symbol.asyncIterator]() {} },
    stdout: { async write(chunk) { output += new TextDecoder().decode(chunk); } },
    stderr: { async write(chunk) { diagnostic += new TextDecoder().decode(chunk); } }
  });
  expect(result.exitCode, diagnostic).toBe(0);
  const parsed = JSON.parse(output);
  const frames = mixed ? parsed.packets_and_frames.filter((row: { type: string }) => row.type === 'frame') : parsed.frames;
  expect(frames).toHaveLength(5);
  expect(frames.filter((frame: { key_frame: number }) => frame.key_frame === 1)).toHaveLength(1);
  for (const frame of frames) {
    expect(frame).not.toHaveProperty('pict_type');
    expect(frame.pts).toBeTypeOf('number');
  }
});
