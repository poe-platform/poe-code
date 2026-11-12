import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

for (const filter of ["volumedetect", "aformat=sample_fmts=s32p,volumedetect", "aformat=sample_fmts=s16,volumedetect", "anull"]) {
  for (const boundarySamples of [false, true]) {
    it(`${filter} narrows signed 32-bit ${boundarySamples ? "boundary samples" : "65535 samples"} to signed 16-bit PCM`, async () => {
      const samples = boundarySamples
        ? [-2147483648, -65537, -65536, -65535, -1, 0, 32768, 65535, 65536, 65537, 2147483647]
        : new Array<number>(1000).fill(65535);
      const input = Buffer.alloc(samples.length * 4);
      const expected = Buffer.alloc(samples.length * 2);
      for (const [i, sample] of samples.entries()) {
        input.writeInt32LE(sample, i * 4);
        expected.writeInt16LE(sample >> 16, i * 2);
      }
      const fs = Volume.fromJSON({});
      fs.writeFileSync("/in.raw", input);
      const stdout: Uint8Array[] = [];
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-hide_banner", "-nostats", "-v", "info", "-f", "s32le", "-ar", "8000", "-ac", "1",
          "-i", "/in.raw", "-af", filter, "-f", "s16le", "pipe:1"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return fs.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { fs.writeFileSync(path, bytes); },
          async stat(path: string) { return fs.statSync(path); }
        },
        stdin: (async function* () {})(),
        stdout: { async write(bytes: Uint8Array) { stdout.push(bytes); } },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      assert.equal(result.exitCode, 0, stderr);
      assert.deepEqual(Buffer.concat(stdout), expected);
      assert.equal(stderr, (filter === "anull" ? "" : boundarySamples
        ? "n_samples: 0\nn_samples: 11\nmean_volume: -7.4 dB\nmax_volume: 0.0 dB\n"
        : "n_samples: 0\nn_samples: 1000\nmean_volume: -91.0 dB\nmax_volume: -91.0 dB\nhistogram_91db: 1000\n"));
    });
  }
}
