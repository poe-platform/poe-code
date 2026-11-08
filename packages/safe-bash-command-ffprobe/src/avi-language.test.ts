import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { MemoryFileSystem } from '@poe-code/safe-fs/core';
import { createCommandArguments } from 'safe-bash-contracts/command';
import { createFfprobeCommand } from './media.js';

for (const stdin of [false, true]) {
  for (const titled of [false, true]) {
    it(`omits undeclared AVI language while retaining titles (stdin=${stdin}, titled=${titled})`, async () => {
      const bytes = readFileSync(new URL('../../mp4-ast/src/fixtures/stream-names.avi', import.meta.url));
      if (!titled) {
        let offset;
        while ((offset = bytes.indexOf("strn")) !== -1) bytes.write("JUNK", offset);
      }
      const fs = new MemoryFileSystem();
      await fs.writeFile('/clip.avi', bytes);
      let output = '', diagnostic = '';
      const result = await createFfprobeCommand().execute({
        command: 'ffprobe', ...createCommandArguments(['-v', 'error', '-show_entries',
          titled ? 'stream=index,codec_name:stream_tags:format_tags' : 'stream=index,codec_name:stream_tags=language:format_tags', '-of', 'json', stdin ? '-' : '/clip.avi']),
        cwd: '/', env: {}, fs, signal: new AbortController().signal,
        stdin: { async *[Symbol.asyncIterator]() { yield bytes; } },
        stdout: { async write(chunk) { output += new TextDecoder().decode(chunk); } },
        stderr: { async write(chunk) { diagnostic += new TextDecoder().decode(chunk); } }
      });
      expect(result.exitCode, diagnostic).toBe(0);
      const probe = JSON.parse(output);
      expect(probe.streams).toEqual([
        { index: 0, codec_name: 'aac', tags: titled ? { title: 'Alice' } : {} },
        { index: 1, codec_name: 'aac', tags: titled ? { title: 'Bob' } : {} }
      ]);
      expect(probe.format.tags).toEqual({ title: 'Meeting', software: 'Lavf63.1.101' });
    });
  }
}
