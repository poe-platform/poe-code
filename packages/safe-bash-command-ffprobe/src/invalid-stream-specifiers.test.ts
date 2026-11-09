import { expect, it } from 'vitest';
import { encodeWav } from '@poe-code/audio-ast';
import { MemoryFileSystem } from '@poe-code/safe-fs/core';
import { createCommandArguments } from 'safe-bash-contracts/command';
import { createFfprobeCommand } from './index.js';

it.each(['a:m', 'a:i:', 'a:i:1junk', 'a:#0xgg', 'a:a:0:1', 'a:0:m:title:Bob', 'p:', 'p:banana', 'p:101junk', 'p:-1', 'p:1.5', 'p:999', 'i:', '#', 'i:0x', '#0xgg', 'i:77junk', 'i:77:1', 'i:-1', 'i:1.5', 'i:1e2', 'i:0b11', 'a:banana', 'bad', 'v:banana', 'a:0junk', 'a:0:1', 'a:-1', 'a:1.5', 's:banana', 'd:', 'd:banana', 'd:0junk', 'd:0:1', 'd:-1', 'd:1.5', 'v', 'a:1', '99', 'a:0', 's:0'])('validates stream selector %s before publishing packets', async selector => {
  const fs = new MemoryFileSystem();
  await fs.writeFile('/input.wav', encodeWav({ sampleRate: 8000, channels: [new Float64Array(16)] }));
  let stdout = '', stderr = '';
  const result = await createFfprobeCommand().execute({
    command: 'ffprobe',
    ...createCommandArguments(['-v', 'error', '-of', 'json', '-select_streams', selector, '-show_entries', 'packet=size', '/input.wav']),
    cwd: '/', env: {}, fs, signal: new AbortController().signal,
    stdin: { async *[Symbol.asyncIterator]() {} },
    stdout: { async write(chunk) { stdout += new TextDecoder().decode(chunk); } },
    stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } }
  });
  if (['p:999', 'v', 'a:1', '99', 'a:0', 's:0'].includes(selector)) {
    expect(result.exitCode).toBe(0);
    expect(stderr).toBe('');
    expect(JSON.parse(stdout).packets).toEqual(selector === 'a:0' ? [{ size: '32' }] : []);
  } else {
    expect(result.exitCode).toBe(1);
    expect(stderr).toContain(`Invalid stream specifier: ${selector}`);
    expect(stdout).toBe('');
  }
});
