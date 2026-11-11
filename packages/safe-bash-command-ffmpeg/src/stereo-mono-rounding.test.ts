import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav, parseAudio } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

const pairs = [
  [12001, 0], [0, -24003], [10000, -10000], [30000, 30000], [-30000, -30000], [5, 6],
  [32767, 32767], [-32768, -32768], [1, 0], [-1, 0], [3, 0], [-3, 0]
];

for (const filter of [undefined, "anull", "aformat=sample_fmts=s16p", "aformat=sample_fmts=flt", "aformat=channel_layouts=mono"]) {
  for (const format of filter === "aformat=channel_layouts=mono" ? ["s16le", "wav"] : ["s16le", "s32le", "wav"]) {
    it(`matches stereo-to-mono PCM rounding for ${filter ?? "-ac 1"} to ${format}`, async () => {
      const volume = Volume.fromJSON({});
      volume.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000,
        channels: [0, 1].map(channel => Float64Array.from(pairs, pair => pair[channel]! / 32768))
      }, { bitsPerSample: 16 }));
      const chunks: Uint8Array[] = [];
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-i", "/in.wav", ...(filter ? ["-af", filter] : []),
          ...(filter === "aformat=channel_layouts=mono" ? [] : ["-ac", "1"]), "-f", format, "pipe:1"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(),
        stdout: { async write(bytes: Uint8Array) { chunks.push(bytes.slice()); } },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      assert.equal(result.exitCode, 0, stderr);
      const bytes = Buffer.concat(chunks);
      const pcm = format === "wav"
        ? Buffer.concat(parseAudio(bytes).nodes.filter(node => node.type === "data").map(node => node.data)) : bytes;
      const width = format === "s32le" ? 4 : 2;
      assert.equal(pcm.length, pairs.length * width);
      // Complete native FFmpeg 7.0.2 output, including signed ties and PCM16 limits.
      assert.deepEqual(Array.from({ length: pairs.length }, (_, i) => pcm.readIntLE(i * width, width)),
        format === "s32le"
          ? [393248768, -786530304, 0, 1966080000, -1966080000, 360448, 2147418112, -2147483648, 32768, -32768, 98304, -98304]
          : filter === "aformat=sample_fmts=flt"
          ? [6000, -12002, 0, 30000, -30000, 6, 32767, -32768, 0, 0, 2, -2]
          : [6001, -12001, 0, 30000, -30000, 6, 32767, -32768, 1, 0, 2, -1]);
    });
  }
}
