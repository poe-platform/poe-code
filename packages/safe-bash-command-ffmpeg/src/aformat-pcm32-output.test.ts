import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav, parseAudio } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

// Complete output samples from FFmpeg 7.0.2 for this stereo PCM16 WAV.
const pairs = [[12001, 0], [0, -24003], [10000, -10000], [30000, 30000], [-30000, -30000], [5, 6]];
const pcm32 = [393248768, -786530304, 0, 1966080000, -1966080000, 360448];
const pcm16 = [6001, -12001, 0, 30000, -30000, 6];
for (const [filter, format, expected] of [
  ["aformat=channel_layouts=mono", "s32le", pcm32],
  ["aformat@mix=cl=mono", "s32le", pcm32],
  ["aformat=sample_fmts=s32:channel_layouts=mono", "s32le", pcm32],
  ["aformat=sample_fmts=s16:channel_layouts=mono", "s32le", pcm16.map(value => value * 65536)],
  ["aformat=channel_layouts=mono", "s16le", pcm16],
  [undefined, "s32le", pcm32]
] as const) {
  for (const graph of [false, true]) {
    for (const container of [format, "wav"]) {
      it(`negotiates ${format} before ${filter ?? "-ac 1"} (graph=${graph}, container=${container})`, async () => {
        const volume = Volume.fromJSON({});
        volume.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000,
          channels: [0, 1].map(channel => Float64Array.from(pairs, pair => pair[channel]! / 32768)) }));
        const stdout: Uint8Array[] = [];
        let stderr = "";
        const result = await createFfmpegCommand().execute({
          args: ["-v", "error", "-i", "/in.wav", ...(filter === undefined ? ["-ac", "1"] : graph
            ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
            ...(container === "wav" ? ["-c:a", `pcm_${format}`] : []), "-f", container, "pipe:1"],
          cwd: "/", env: {}, signal: new AbortController().signal,
          fs: {
            async readFile(path: string) { return volume.readFileSync(path); },
            async writeFile(path: string, data: Uint8Array) { volume.writeFileSync(path, data); },
            async stat(path: string) { return volume.statSync(path); }
          },
          stdin: (async function* () {})(),
          stdout: { async write(data: Uint8Array) { stdout.push(data); } },
          stderr: { async write(data: Uint8Array) { stderr += new TextDecoder().decode(data); } }
        } as never);
        assert.equal(result.exitCode, 0, stderr);
        const bytes = Buffer.concat(stdout);
        const output = container === "wav"
          ? Buffer.concat(parseAudio(bytes).nodes.filter(node => node.type === "data").map(node => node.data)) : bytes;
        const width = format === "s16le" ? 2 : 4;
        assert.equal(output.length, expected.length * width);
        assert.deepEqual(Array.from({ length: expected.length }, (_, index) => output.readIntLE(index * width, width)), expected);
      });
    }
  }
}
