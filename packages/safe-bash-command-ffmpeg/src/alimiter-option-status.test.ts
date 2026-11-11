import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2 distinguishes option lookup, range and expression errors.
for (const [option, exitCode, diagnostic] of [
  ["bogus=1", 8, "unsupported option bogus"],
  ["release=0", 222, "release"],
  ["release=invalid", 234, "expression"]
] as const) {
  for (const graph of [false, true]) {
    it(`alimiter ${option} exits ${exitCode} without emitting PCM (${graph ? "graph" : "simple"})`, async () => {
      const fs = Volume.fromJSON({});
      fs.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000, channels: [Float64Array.from([
        1000, -2000, 3000, -4000, 5000, -6000, 7000, -8000,
        9000, -10000, 11000, -12000, 13000, -14000, 15000, -16000
      ], sample => sample / 32768)] }));
      const output: Uint8Array[] = [];
      const errors: Uint8Array[] = [];
      const filter = `alimiter=attack=0.5:level=0:${option}`;
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-i", "/in.wav", ...(graph
          ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"]
          : ["-af", filter]), "-f", "s16le", "pipe:1"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return fs.readFileSync(path); },
          async stat(path: string) { return fs.statSync(path); }
        },
        stdin: (async function* () {})(),
        stdout: { async write(bytes: Uint8Array) { output.push(bytes); } },
        stderr: { async write(bytes: Uint8Array) { errors.push(bytes); } }
      } as never);
      const stderr = Buffer.concat(errors).toString();
      assert.equal(result.exitCode, exitCode, stderr);
      assert.equal(Buffer.concat(output).length, 0);
      assert.ok(stderr.includes(diagnostic), stderr);
    });
  }
}
