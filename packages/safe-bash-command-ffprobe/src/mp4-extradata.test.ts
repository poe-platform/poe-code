import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createFfprobeCommand, evalSyncFfprobe } from "./media.js";

for (const [fixture, sizes] of [
  ["packet-positions-interleaved", [46, 5]],
  ["packet-positions-faststart", [46]],
  ["packet-positions-fragmented", [46, 5]],
  ["h264-b-frames", [45]]
] as const) {
  for (const mode of ["file", "stdin", "sync"]) {
    it(`reports native decoder configuration sizes for ${fixture} via ${mode}`, async () => {
      const bytes = readFileSync(new URL(`../../mp4-ast/src/fixtures/${fixture}.mp4`, import.meta.url));
      const args = ["-v", "error", "-show_entries", "stream=index,codec_name,extradata_size", "-of", "json", mode === "file" ? "/clip.mp4" : "-"];
      let output = "", diagnostic = "";
      if (mode === "sync") output = evalSyncFfprobe(bytes, args)!;
      else {
        const fs = new MemoryFileSystem();
        await fs.writeFile("/clip.mp4", bytes);
        const result = await createFfprobeCommand().execute({
          command: "ffprobe", ...createCommandArguments(args), cwd: "/", env: {}, fs,
          signal: new AbortController().signal,
          stdin: { async *[Symbol.asyncIterator]() { yield bytes; } },
          stdout: { async write(chunk) { output += new TextDecoder().decode(chunk); } },
          stderr: { async write(chunk) { diagnostic += new TextDecoder().decode(chunk); } }
        });
        expect(result.exitCode, diagnostic).toBe(0);
      }
      expect(JSON.parse(output)).toEqual({ programs: [], stream_groups: [], streams: sizes.map((size, index) => ({
        index, codec_name: index === 0 ? "h264" : "aac", extradata_size: size
      })) });
    });
  }
}

// Expected bytes and hashes from native ffprobe for the checked-in fixture.
const nativeData = [
  '\n00000000: 0164 000a ffe1 0019 6764 000a acd9 497e  .d......gd....I~\n00000010: 5c04 4000 0003 0040 0000 0302 83c4 8965  \\.@....@.......e\n00000020: 8001 0006 68eb e3cb 22c0 fdf8 f800       ....h...".....\n',
  '\n00000000: 1588 56e5 00                             ..V..\n'
];
const nativeHashes = ['SHA256:36a23ef9171253deeb121b49fb1f0db68e6fa4005760493e697ec9f1b03d8c57', 'SHA256:431b3b58ebe273bca438d591fc9bd2fd87b5dd8621c2884876490fa73bc512db'];
for (const mode of ['file', 'stdin', 'sync']) {
  for (const flags of [[], ['-show_data'], ['-show_data_hash', 'sha256'], ['-show_data', '-show_data_hash', 'sha256']]) {
    it(`exposes only requested stream configuration data via ${mode}: ${flags.join(' ')}`, async () => {
      const bytes = readFileSync(new URL('../../mp4-ast/src/fixtures/packet-positions-interleaved.mp4', import.meta.url));
      const args = [...flags, '-show_entries', 'stream=index,extradata_size,extradata,extradata_hash', '-of', 'json', mode === 'file' ? '/clip.mp4' : '-'];
      let output = '', diagnostic = '';
      if (mode === 'sync') output = evalSyncFfprobe(bytes, args)!;
      else {
        const fs = new MemoryFileSystem();
        await fs.writeFile('/clip.mp4', bytes);
        const result = await createFfprobeCommand().execute({
          command: 'ffprobe', ...createCommandArguments(args), cwd: '/', env: {}, fs,
          signal: new AbortController().signal,
          stdin: { async *[Symbol.asyncIterator]() { yield bytes; } },
          stdout: { async write(chunk) { output += new TextDecoder().decode(chunk); } },
          stderr: { async write(chunk) { diagnostic += new TextDecoder().decode(chunk); } }
        });
        expect(result.exitCode, diagnostic).toBe(0);
      }
      expect(JSON.parse(output)).toEqual({ programs: [], stream_groups: [], streams: [46, 5].map((size, index) => ({
        index, extradata_size: size,
        ...(flags.includes('-show_data') ? { extradata: nativeData[index] } : {}),
        ...(flags.includes('-show_data_hash') ? { extradata_hash: nativeHashes[index] } : {})
      })) });
    });
  }
}
