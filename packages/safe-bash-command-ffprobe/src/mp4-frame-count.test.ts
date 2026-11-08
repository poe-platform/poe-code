import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { probeMp4 } from '@poe-code/mp4-ast';
import { MemoryFileSystem } from '@poe-code/safe-fs/core';
import { createCommandArguments } from 'safe-bash-contracts/command';
import { createFfprobeCommand } from './media.js';

// Expected metadata and read counts verified against native ffprobe.
for (const layout of ['fragmented', 'interleaved']) {
  const bytes = readFileSync(new URL(`../../mp4-ast/src/fixtures/packet-positions-${layout}.mp4`, import.meta.url));
  it(`reports only declared MP4 frame counts through the SDK: ${layout}`, () => {
    expect(probeMp4(bytes).streams.map(stream => stream.nb_frames)).toEqual(
      layout === 'fragmented' ? [undefined, undefined] : ['5', '9']
    );
  });
  for (const count of [false, true]) it(`reports declared and requested MP4 counts: ${layout}, count=${count}`, async () => {
    const fs = new MemoryFileSystem();
    await fs.writeFile('/input.mp4', bytes);
    let output = '', diagnostic = '';
    const result = await createFfprobeCommand().execute({
      command: 'ffprobe',
      ...createCommandArguments(['-v', 'error', '-show_streams',
        ...(count ? ['-count_frames', '-count_packets'] : []),
        '-show_entries', 'stream=index,codec_type,nb_frames,nb_read_frames,nb_read_packets', '-of', 'json', '/input.mp4']),
      cwd: '/', env: {}, fs, signal: new AbortController().signal,
      stdin: { async *[Symbol.asyncIterator]() {} },
      stdout: { async write(chunk) { output += new TextDecoder().decode(chunk); } },
      stderr: { async write(chunk) { diagnostic += new TextDecoder().decode(chunk); } }
    });
    expect(result.exitCode, diagnostic).toBe(0);
    expect(JSON.parse(output).streams).toEqual(['video', 'audio'].map((codec_type, index) => ({
      index, codec_type,
      ...(layout === 'interleaved' ? { nb_frames: index === 0 ? '5' : '9' } : {}),
      ...(count ? { nb_read_packets: index === 0 ? '5' : '9',
        nb_read_frames: index === 0 ? '5' : layout === 'fragmented' ? '9' : '8' } : {})
    })));
  });
}
