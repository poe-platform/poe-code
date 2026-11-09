import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { MemoryFileSystem } from '@poe-code/safe-fs/core';
import { createCommandArguments } from 'safe-bash-contracts/command';
import { createFfprobeCommand } from './media.js';

for (const [band, samples, skip, count] of [['nb', 160, 50, 7], ['wb', 320, 80, 6]] as const) {
  for (const flat of [false, true]) for (const route of ['file', 'stdin', 'stream']) {
    for (const section of ['packet', 'frame', 'both']) {
      it(`reports AMR ${band} edit-list timing: flat=${flat}, ${route}, ${section}`, async () => {
        const bytes = readFileSync(new URL(`../../mp4-ast/src/fixtures/amr-edit-${band}${flat ? '-flat' : ''}.3gp`, import.meta.url));
        const base = new MemoryFileSystem();
        await base.writeFile('/input.3gp', bytes);
        const capabilities = { ...base.capabilities, retainedRead: false, streamingRead: true };
        const fs = route === 'stream' ? new Proxy(base, { get(target, key) {
          if (key === 'capabilities') return capabilities;
          if (key === 'capabilitiesFor') return async () => capabilities;
          const value = Reflect.get(target, key, target);
          return typeof value === 'function' ? value.bind(target) : value;
        } }) : base;
        let output = '', diagnostic = '';
        const entries = [
          ...(section !== 'frame' ? ['packet=pts,duration', 'packet_side_data=side_data_type,skip_samples,discard_padding'] : []),
          ...(section !== 'packet' ? ['frame=pts,duration,nb_samples'] : [])
        ].join(':');
        const result = await createFfprobeCommand().execute({
          command: 'ffprobe', ...createCommandArguments(['-v', 'error', '-show_entries', entries, '-of', 'json', route === 'stdin' ? '-' : '/input.3gp']),
          cwd: '/', env: {}, fs, signal: new AbortController().signal,
          stdin: { async *[Symbol.asyncIterator]() { yield bytes; } },
          stdout: { async write(chunk) { output += new TextDecoder().decode(chunk); } },
          stderr: { async write(chunk) { diagnostic += new TextDecoder().decode(chunk); } }
        });
        expect(result.exitCode, diagnostic).toBe(0);
        const skipped = flat ? 0 : skip;
        const packets = Array.from({ length: count }, (_, i) => ({
          pts: i * samples - skipped,
          duration: band === 'nb' && i === count - 1 ? 50 : samples,
          ...(i === 0 && skipped ? { side_data_list: [{ side_data_type: 'Skip Samples', skip_samples: skipped, discard_padding: 0 }] } : {})
        }));
        const frames = packets.map((packet, i) => ({
          pts: packet.pts + (i === 0 ? skipped : 0),
          duration: packet.duration - (i === 0 ? skipped : 0),
          nb_samples: samples - (i === 0 ? skipped : 0)
        }));
        expect(JSON.parse(output)).toEqual(section === 'both'
          ? { packets_and_frames: packets.flatMap((packet, i) => [{ type: 'packet', ...packet }, { type: 'frame', ...frames[i] }]) }
          : section === 'packet' ? { packets } : { frames });
      });
    }
  }
}
