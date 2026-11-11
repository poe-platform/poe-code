import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

// FFmpeg 7.0.2, mono signed PCM16 at 8 kHz, constant 16000 samples.
for (const [curve, expected] of [
  ["dese", [0, 3999, 5039, 5768, 6349, 6839, 7268, 7651]],
  ["tri", [0, 1000, 2000, 3000, 4000, 5000, 6000, 7000]],
  ["cbr", [0, 6349, 7999, 9157, 10079, 10857, 11537, 12146]]
] as const) {
  for (const graph of [false, true]) {
    for (const polarity of [1, -1]) it(`afade ${curve} matches native PCM16 at sixteenths (${graph ? "graph" : "simple"}, polarity ${polarity})`, async () => {
      const fs = Volume.fromJSON({});
      fs.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000,
        channels: [new Float64Array(8).fill(16000 * polarity / 32768)]
      }));
      const filter = `afade=ns=16:c=${curve}`;
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-i", "/in.wav",
          ...(graph ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
          "-f", "s16le", "/out.raw"],
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
      const output = Buffer.alloc(expected.length * 2);
      expected.forEach((sample, index) => output.writeInt16LE(sample * polarity, index * 2));
      assert.deepEqual(fs.readFileSync("/out.raw"), output);
    });
  }
}
