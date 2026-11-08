import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { MemoryFileSystem } from '@poe-code/safe-fs/core';
import { createCommandArguments } from 'safe-bash-contracts/command';
import { createFfprobeCommand } from './media.js';

// Native ffprobe omits stream duration, ID and declared frame count for these bytes.
const bytes = readFileSync(new URL('../../mp4-ast/src/fixtures/chapters.mka', import.meta.url));
for (const count of [false, true]) {
  it(`keeps Matroska metadata separate from requested read counts: count=${count}`, async () => {
    const fs = new MemoryFileSystem();
    await fs.writeFile('/meeting.mka', bytes);
    let output = '', diagnostic = '';
    const result = await createFfprobeCommand().execute({
      command: 'ffprobe',
      ...createCommandArguments(['-v', 'error', '-show_streams', '-show_format',
        ...(count ? ['-count_frames', '-count_packets'] : []),
        '-show_entries', 'stream=index,id,duration_ts,duration,nb_frames,nb_read_frames,nb_read_packets:format=duration',
        '-of', 'json', '/meeting.mka']),
      cwd: '/', env: {}, fs, signal: new AbortController().signal,
      stdin: { async *[Symbol.asyncIterator]() {} },
      stdout: { async write(chunk) { output += new TextDecoder().decode(chunk); } },
      stderr: { async write(chunk) { diagnostic += new TextDecoder().decode(chunk); } }
    });
    expect(result.exitCode, diagnostic).toBe(0);
    expect(JSON.parse(output)).toEqual({
      programs: [], stream_groups: [],
      streams: [{ index: 0, ...(count ? { nb_read_packets: '8', nb_read_frames: '8' } : {}) }],
      format: { duration: '1.000000' }
    });
  });
}
