import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { MemoryFileSystem } from '@poe-code/safe-fs/core';
import { createCommandArguments } from 'safe-bash-contracts/command';
import { createFfprobeCommand } from './index.js';

for (const fixture of ['track', 'many', 'long']) for (const file of [true, false]) {
  it(`reads native QuickTime chapters: ${fixture}, file=${file}`, async () => {
    const bytes = readFileSync(new URL(`../../mp4-ast/src/fixtures/chapters/${fixture}.mp4`, import.meta.url));
    const fs = new MemoryFileSystem();
    if (file) await fs.writeFile('/input.mp4', bytes);
    const args = ['-v', 'error', '-of', 'json', '-show_chapters', '-show_entries',
      'chapter=start_time,end_time:chapter_tags=title', file ? '/input.mp4' : '-'];
    let output = '', diagnostic = '';
    const result = await createFfprobeCommand().execute({
      command: 'ffprobe', ...createCommandArguments(args), cwd: '/', env: {}, fs,
      signal: new AbortController().signal,
      stdin: { async *[Symbol.asyncIterator]() { if (!file) yield bytes; } },
      stdout: { async write(chunk) { output += new TextDecoder().decode(chunk); } },
      stderr: { async write(chunk) { diagnostic += new TextDecoder().decode(chunk); } }
    });
    expect(result.exitCode, diagnostic).toBe(0);
    const expected = fixture === 'track' ? [[0, 1, 'A'], [1, 3, 'B']] : fixture === 'long'
      ? [[0, 3, 'q'.repeat(270) + 'HELLO']]
      : Array.from({ length: 260 }, (_, i) => [i / 100, (i + 1) / 100, String(i)]);
    expect(JSON.parse(output).chapters.map((chapter: { start_time: string; end_time: string; tags: { title: string } }) =>
      [Number(chapter.start_time), Number(chapter.end_time), chapter.tags.title])).toEqual(expected);
  });
}
