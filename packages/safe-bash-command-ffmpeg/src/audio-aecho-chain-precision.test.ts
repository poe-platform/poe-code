import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2 PCM16, including the complete echo tail.
const echo = "aecho=0.7:0.8:0.25:0.3";
for (const [middle, integer, floating] of [
  ["asetrate=8000", [560, 0, 240, 0, 0, 0, 0, 0, 0, 0], [561, 0, 240, 0, 0, 0, 0, 0, 0, 0]],
  ["adelay=0", [560, 0, 240, 0, 0, 0, 0, 0, 0, 0], [561, 0, 240, 0, 0, 0, 0, 0, 0, 0]],
  ["aecho=1:1:0.125:0.5", [560, 280, 240, 120, 0, 0, 0, 0, 0, 0, 0], [561, 280, 240, 120, 0, 0, 0, 0, 0, 0, 0]],
  ["aphaser", [165, 66, 97, 39, 15, 6, 2, 0, 0, 0], [166, 66, 98, 39, 16, 6, 3, 1, 0, 0]]
] as const) {
  for (const [filter, expected] of [
    [`${echo},${middle},volume=1`, floating],
    [`${echo},${middle},volume=1:precision=double`, floating],
    [`${echo},${middle}`, integer],
    [`${echo},${middle},volume=1:precision=fixed`, integer],
    [`${echo},${middle},aformat=s16p,volume=1`, integer],
    [`aformat=fltp,${echo},${middle},volume=1`, floating]
  ] as const) {
    for (const graph of [false, true]) {
      it(`echo negotiates precision through ${filter} (${graph ? "graph" : "simple"})`, async () => {
        const fs = Volume.fromJSON({});
        fs.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000, channels: [
          Float64Array.from([1001, 0, 0, 0, 0, 0, 0, 0], sample => sample / 32768)
        ] }));
        let stderr = "";
        const result = await createFfmpegCommand().execute({
          args: ["-v", "error", "-i", "/in.wav", ...(graph
            ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
            "-f", "s16le", "/out.pcm"],
          cwd: "/", env: {}, signal: new AbortController().signal,
          fs: {
            async readFile(path: string) { return fs.readFileSync(path); },
            async writeFile(path: string, bytes: Uint8Array) { fs.writeFileSync(path, bytes); },
            async stat(path: string) { return fs.statSync(path); }
          },
          stdin: (async function* () {})(), stdout: { async write() {} },
          stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
        } as never);
        assert.equal(result.exitCode, 0, stderr);
        const pcm = fs.readFileSync("/out.pcm") as Buffer;
        assert.equal(pcm.length, expected.length * 2);
        assert.deepEqual(Array.from({ length: pcm.length / 2 }, (_, i) => pcm.readInt16LE(i * 2)), expected);
      });
    }
  }
}
