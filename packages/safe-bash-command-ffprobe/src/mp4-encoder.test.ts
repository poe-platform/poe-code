import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { MemoryFileSystem } from '@poe-code/safe-fs/core';
import { probeMp4 } from '@poe-code/mp4-ast';
import { createCommandArguments } from 'safe-bash-contracts/command';
import { createFfprobeCommand } from './media.js';

for (const layout of ['faststart', 'interleaved']) {
  const bytes = readFileSync(new URL(`../../mp4-ast/src/fixtures/packet-positions-${layout}.mp4`, import.meta.url));
  it(`preserves the resident MP4 video encoder: ${layout}`, () => {
    expect(probeMp4(bytes).streams[0]!.tags?.encoder).toBe('Lavc63.1.101 libx264');
  });
  for (const stdin of [false, true]) for (const selected of [false, true]) {
    it(`reports the MP4 video encoder: ${layout}, stdin=${stdin}, selected=${selected}`, async () => {
      const fs = new MemoryFileSystem();
      await fs.writeFile('/clip.mp4', bytes);
      let output = '', diagnostic = '';
      const result = await createFfprobeCommand().execute({
        command: 'ffprobe', ...createCommandArguments(['-v', 'error',
          ...(selected ? ['-show_entries', 'stream=index:stream_tags=encoder'] : ['-show_streams']),
          '-of', 'json', stdin ? '-' : '/clip.mp4']),
        cwd: '/', env: {}, fs, signal: new AbortController().signal,
        stdin: { async *[Symbol.asyncIterator]() { if (stdin) yield bytes; } },
        stdout: { async write(chunk) { output += new TextDecoder().decode(chunk); } },
        stderr: { async write(chunk) { diagnostic += new TextDecoder().decode(chunk); } }
      });
      expect(result.exitCode, diagnostic).toBe(0);
      const streams = JSON.parse(output).streams;
      expect(streams[0].tags.encoder).toBe('Lavc63.1.101 libx264');
      for (const stream of streams.slice(1)) expect(stream.tags.encoder).toBeUndefined();
    });
  }
}
