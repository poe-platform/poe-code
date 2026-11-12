import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2 outputs for four stereo PCM16 frames at 8 kHz.
const decorrelated = [6416, -5522, 6453, -5999, 5157, -5026, 2925, -3091];
const phased = [1899, -1635, 2670, -2429, 2594, -2460, 1903, -1899];
for (const [filter, expected] of [
  ["adecorrelate=1:7,aphaser", phased],
  ["adecorrelate=1:7,aformat=sample_fmts=s16", decorrelated],
  ["adecorrelate=1:7,aformat=sample_fmts=s16p", decorrelated],
  ["adecorrelate=1:7,aresample=osf=s16", decorrelated],
  ["adecorrelate=1:7,aformat=sample_fmts=dblp,aphaser", phased],
  ["adecorrelate=1:7,aformat=sample_fmts=dblp,aformat=sample_fmts=s16", decorrelated],
  ["adecorrelate=1:7", decorrelated],
  ["aphaser", [4736, -4736, 4262, -4262, 2888, -2888, 1155, -1155]]
] as const) {
  for (const graph of [false, true]) {
    it(`${filter} preserves native PCM16 precision (${graph ? "graph" : "simple"})`, async () => {
      const volume = Volume.fromJSON({});
      volume.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000, channels: [
        Float64Array.from([16000, 8000, 4000, 0], sample => sample / 32768),
        Float64Array.from([-16000, -8000, -4000, 0], sample => sample / 32768)
      ] }, { bitsPerSample: 16 }));
      const chunks: Buffer[] = [];
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-i", "/in.wav", ...(graph
          ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"]
          : ["-af", filter]), "-f", "s16le", "pipe:1"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(),
        stdout: { async write(bytes: Uint8Array) { chunks.push(Buffer.from(bytes)); } },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      assert.equal(result.exitCode, 0, stderr);
      const pcm = Buffer.concat(chunks);
      assert.equal(pcm.length, expected.length * 2);
      assert.deepEqual(Array.from({ length: pcm.length / 2 }, (_, i) => pcm.readInt16LE(i * 2)), expected);
    });
  }
}
