import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { MemoryFileSystem } from '@poe-code/safe-fs/core';
import { createCommandArguments } from 'safe-bash-contracts/command';
import { createFfprobeCommand } from './media.js';

for (const stdin of [false, true]) {
  it(`reports native uncompressed BGR AVI metadata and padded packets (stdin=${stdin})`, async () => {
    const bytes = readFileSync(new URL('../../mp4-ast/src/fixtures/bgr24.avi', import.meta.url));
    const fs = new MemoryFileSystem();
    await fs.writeFile('/clip.avi', bytes);
    let output = '', diagnostic = '';
    const result = await createFfprobeCommand().execute({
      command: 'ffprobe', ...createCommandArguments(['-v', 'error', '-show_packets', '-show_entries',
        'stream=codec_name,pix_fmt,width,height,avg_frame_rate:packet=pts,size',
        '-of', 'json', stdin ? '-' : '/clip.avi']),
      cwd: '/', env: {}, fs, signal: new AbortController().signal,
      stdin: { async *[Symbol.asyncIterator]() { yield bytes; } },
      stdout: { async write(chunk) { output += new TextDecoder().decode(chunk); } },
      stderr: { async write(chunk) { diagnostic += new TextDecoder().decode(chunk); } }
    });
    expect(result.exitCode, diagnostic).toBe(0);
    const probe = JSON.parse(output);
    expect(probe.streams).toEqual([{ codec_name: 'rawvideo', pix_fmt: 'bgr24', width: 3, height: 2, avg_frame_rate: '5/1' }]);
    expect(probe.packets).toHaveLength(4);
    expect(probe.packets.map((packet: { size: string }) => packet.size)).toEqual(['24', '24', '24', '24']);
  });
}
