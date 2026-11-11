import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

for (const filter of ["volumedetect", "volumedetect,volume=2", "anull"]) {
  for (const level of ["info", "error"]) {
    it(`${filter} converts half-step float samples at ${level} log level`, async () => {
      const fs = Volume.fromJSON({});
      fs.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000,
        channels: [new Float64Array(2400).fill(0.5 / 32768)]
      }, { float: true, bitsPerSample: 32 }));
      const stdout: Uint8Array[] = [];
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-hide_banner", "-nostats", "-v", level, "-i", "/in.wav", "-af", filter, "-f", "f32le", "-"],
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
      const expected = Buffer.alloc(9600);
      if (filter === "anull") {
        for (let i = 0; i < 2400; i++) expected.writeFloatLE(0.5 / 32768, i * 4);
      }
      assert.deepEqual(Buffer.concat(stdout), expected);
      assert.equal(stderr, level === "info" && filter !== "anull"
        ? "n_samples: 0\nn_samples: 2400\nmean_volume: -91.0 dB\nmax_volume: -91.0 dB\nhistogram_91db: 2400\n" : "");
    });
  }
}
