import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 9.0.1 PCM16, including register isolation and the complete tail.
for (const [options, expected] of [
  [String.raw`st(0\,0.5):1:0.25:0.5`, [500, -1001, 2003, -3005, 1502, -2003]],
  ["0.5:1:0.25:0.5", [500, -1001, 2003, -3005, 1502, -2003]],
  [String.raw`in_gain=st(0\,0.5)+ld(0):out_gain=0.5:delays=0.25:decays=0.5`, [500, -1001, 1752, -2504, 751, -1001]],
  [String.raw`in_gain=st(0\,0.5):out_gain=ld(0):delays=0.25:decays=0.5`, [0, 0, 0, 0, 0, 0]],
  [String.raw`in_gain=st(0\,0.5):in_gain=ld(0):out_gain=1:delays=0.25:decays=0.5`, [0, 0, 500, -1001, 1502, -2003]],
  [String.raw`0.5:st(9\,1):0.25|0.5:0.5|0.25`, [500, -1001, 2003, -3005, 1752, -2504, 751, -1001]]
] as const) {
  for (const graph of [false, true]) {
    it(`aecho register gains ${options} (${graph ? "graph" : "simple"})`, async () => {
      const fs = Volume.fromJSON({});
      fs.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000, channels: [
        Float64Array.from([1001, -2003, 3005, -4007], sample => sample / 32768)
      ] }));
      const output: Buffer[] = [];
      let stderr = "";
      const filter = `aecho=${options}`;
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-i", "/in.wav", ...(graph
          ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
          "-f", "s16le", "pipe:1"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return fs.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { fs.writeFileSync(path, bytes); },
          async stat(path: string) { return fs.statSync(path); }
        },
        stdin: (async function* () {})(),
        stdout: { async write(bytes: Uint8Array) { output.push(Buffer.from(bytes)); } },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      assert.equal(result.exitCode, 0, stderr);
      const pcm = Buffer.concat(output);
      assert.deepEqual(Array.from({ length: pcm.length / 2 }, (_, i) => pcm.readInt16LE(i * 2)), expected);
    });
  }
}
