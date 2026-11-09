import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { MemoryFileSystem } from '@poe-code/safe-fs/core';
import { createCommandArguments } from 'safe-bash-contracts/command';
import { createFfprobeCommand, evalSyncFfprobe } from './media.js';

for (const band of ['nb', 'wb']) {
  for (const suffix of ['', '-flat']) {
    it(`reports native AMR-${band} stream and frame metadata${suffix}`, async () => {
      const bytes = readFileSync(new URL(`../../mp4-ast/src/fixtures/amr-${band}${suffix}.3gp`, import.meta.url));
      const args = ['-v', 'error', '-show_entries',
        'stream=codec_name,codec_long_name,codec_tag_string,sample_rate,channels,channel_layout,bits_per_sample:frame=channels,channel_layout',
        '-of', 'json', '/in.3gp'];
      const expected = {
        streams: [{
          codec_name: `amr_${band}`,
          codec_long_name: band === 'nb' ? 'AMR-NB (Adaptive Multi-Rate NarrowBand)' : 'AMR-WB (Adaptive Multi-Rate WideBand)',
          codec_tag_string: band === 'nb' ? 'samr' : 'sawb',
          sample_rate: band === 'nb' ? '8000' : '16000',
          channels: 1, channel_layout: 'mono', bits_per_sample: 0
        }],
        frames: Array.from({ length: band === 'nb' ? 7 : 6 }, () => ({ channels: 1, channel_layout: 'mono' }))
      };
      expect(JSON.parse(evalSyncFfprobe(bytes, [...args.slice(0, -1), 'pipe:0'])!)).toMatchObject(expected);
      const fs = new MemoryFileSystem();
      await fs.writeFile('/in.3gp', bytes);
      let output = '', diagnostic = '';
      const result = await createFfprobeCommand().execute({
        command: 'ffprobe', ...createCommandArguments(args), cwd: '/', env: {}, fs,
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write(bytes) { output += new TextDecoder().decode(bytes); } },
        stderr: { async write(bytes) { diagnostic += new TextDecoder().decode(bytes); } }
      });
      expect(result.exitCode, diagnostic).toBe(0);
      expect(JSON.parse(output)).toMatchObject(expected);
    });
  }
}
