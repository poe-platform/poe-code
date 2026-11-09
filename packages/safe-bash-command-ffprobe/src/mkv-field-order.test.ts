import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { MemoryFileSystem } from '@poe-code/safe-fs/core';
import { createCommandArguments } from 'safe-bash-contracts/command';
import { createFfprobeCommand } from './media.js';

// Original native FFmpeg fixtures: testsrc2=s=64x32:r=2:d=1,
// libvpx -threads 1 -g 1 -field_order progressive/tt/bb.
for (const [fixture, fieldOrder, order, interlaced] of [
  ['normal', 'progressive', undefined, undefined],
  ['top', 'tt', undefined, undefined],
  ['bottom', 'bb', undefined, undefined],
  ['top', 'tb', 9, 1],
  ['top', 'bt', 14, 1],
  ['top', 'progressive', 1, 2],
  ['top', 'progressive', 0, 1]
] as const) {
  it(`reports Matroska field order through ffprobe: ${fixture} ${fieldOrder}`, async () => {
    const bytes = readFileSync(new URL(`../../mp4-ast/src/fixtures/vp8-field-${fixture}.mkv`, import.meta.url));
    // Change only the one-byte EBML values for additional native-verified cases.
    if (order !== undefined && interlaced !== undefined) {
      const orderOffset = bytes.indexOf(Buffer.from([0x9d, 0x81]));
      const interlacedOffset = bytes.indexOf(Buffer.from([0x9a, 0x81]));
      expect(orderOffset).toBeGreaterThan(0);
      expect(interlacedOffset).toBeGreaterThan(0);
      bytes[orderOffset + 2] = order;
      bytes[interlacedOffset + 2] = interlaced;
    }
    const fs = new MemoryFileSystem();
    await fs.writeFile('/clip.mkv', bytes);
    let output = '', diagnostic = '';
    const result = await createFfprobeCommand().execute({
      command: 'ffprobe', ...createCommandArguments(['-v', 'error', '-show_entries', 'stream=width,height,field_order', '-of', 'json', '/clip.mkv']),
      cwd: '/', env: {}, fs, signal: new AbortController().signal,
      stdin: { async *[Symbol.asyncIterator]() {} },
      stdout: { async write(chunk) { output += new TextDecoder().decode(chunk); } },
      stderr: { async write(chunk) { diagnostic += new TextDecoder().decode(chunk); } }
    });
    expect(result.exitCode, diagnostic).toBe(0);
    expect(JSON.parse(output).streams).toEqual([{ width: 64, height: 32, field_order: fieldOrder }]);
  });
}
