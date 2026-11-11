import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

async function run(options: string, graph: boolean) {
  const fs = Volume.fromJSON({ "/out.pcm": "KEEP" });
  fs.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000, channels: [Float64Array.from(
    [1000, -2000, 3000, -4000, 5000, -6000, 7000, -8000, 9000, -10000, 11000, -12000, 13000, -14000, 15000, -16000],
    sample => sample / 32768
  )] }));
  let stderr = "";
  const filter = `alimiter=${options}`;
  const result = await createFfmpegCommand().execute({
    args: ["-v", "error", "-y", "-i", "/in.wav", ...(graph
      ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"]
      : ["-af", filter]), "-f", "s16le", "/out.pcm"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return fs.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { fs.writeFileSync(path, bytes); },
      async stat(path: string) { return fs.statSync(path); }
    },
    stdin: (async function* () {})(), stdout: { async write() {} },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  return { result, stderr, output: fs.readFileSync("/out.pcm") as Buffer };
}

for (const graph of [false, true]) {
  for (const options of ["attack=0.5:level=0:enable=1", "attack=0.5:level=0", "1:1:1:0.5:50:0:0.5:0:0"]) {
    it(`accepts one terminal alimiter separator after ${options} (${graph ? "graph" : "simple"})`, async () => {
      for (const suffix of ["", ":"]) {
        const { result, stderr, output } = await run(options + suffix, graph);
        assert.equal(result.exitCode, 0, stderr);
        assert.equal(stderr, "");
        // Native FFmpeg 7.0.2 PCM16 output for the same WAV and options.
        assert.deepEqual(Array.from({ length: output.length / 2 }, (_, i) => output.readInt16LE(i * 2)),
          [0, 0, 0, 1000, -2000, 3000, -4000, 5000, -6000, 7000, -8000, 9000, -10000, 11000, -12000, 13000]);
      }
    });
  }

  for (const options of ["attack=0.5:level=0:enable=1::", "attack=0.5::level=0", "attack=:", "level=:", "enable=:"]) {
    it(`rejects empty alimiter options in ${options} without replacing output (${graph ? "graph" : "simple"})`, async () => {
      const { result, stderr, output } = await run(options, graph);
      assert.notEqual(result.exitCode, 0, stderr);
      assert.ok(stderr.includes("alimiter"), stderr);
      assert.equal(output.toString(), "KEEP");
    });
  }
}
