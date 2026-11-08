import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { MemoryFileSystem } from '@poe-code/safe-fs/core';
import { createCommandArguments } from 'safe-bash-contracts/command';
import { createFfprobeCommand } from './media.js';

for (const stdin of [false, true]) {
  it(`reports native uncompressed RGB NUT metadata and packet timestamps (stdin=${stdin})`, async () => {
    const bytes = readFileSync(new URL('../../mp4-ast/src/fixtures/rgb.nut', import.meta.url));
    const fs = new MemoryFileSystem();
    await fs.writeFile('/clip.nut', bytes);
    let output = '', diagnostic = '';
    const result = await createFfprobeCommand().execute({
      command: 'ffprobe', ...createCommandArguments(['-v', 'error', '-show_packets', '-show_entries',
        'stream=codec_name,pix_fmt,width,height,avg_frame_rate:packet=pts,size',
        '-of', 'json', stdin ? '-' : '/clip.nut']),
      cwd: '/', env: {}, fs, signal: new AbortController().signal,
      stdin: { async *[Symbol.asyncIterator]() { yield bytes; } },
      stdout: { async write(chunk) { output += new TextDecoder().decode(chunk); } },
      stderr: { async write(chunk) { diagnostic += new TextDecoder().decode(chunk); } }
    });
    expect(result.exitCode, diagnostic).toBe(0);
    const probe = JSON.parse(output);
    expect(probe.streams).toEqual([{ codec_name: 'rawvideo', pix_fmt: 'rgb24', width: 3, height: 2, avg_frame_rate: '5/1' }]);
    expect(probe.packets.map((packet: { pts: number }) => packet.pts)).toEqual([0, 16384, 32768, 49152]);
    expect(probe.packets.map((packet: { size: string }) => packet.size)).toEqual(['18', '18', '18', '18']);
  });
}
