import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

async function run(options: string, graph: boolean) {
  const fs = Volume.fromJSON({ "/out.pcm": "sentinel" });
  fs.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000, channels: [
    Float64Array.from({ length: 4097 }, (_, i) =>
      (i % 16 < 8 ? 1 : -1) * [0.1, 0.9, 0.05, 0.4][Math.min(3, Math.floor(i / 1024))]!)
  ] }));
  let stderr = "";
  const filter = `speechnorm=${options}`;
  const result = await createFfmpegCommand().execute({
    args: ["-y", "-i", "/in.wav", ...(graph
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
  for (const [expression, literal] of [
    ["p=0x1", "p=1"],
    ["p=1/2", "p=0.5"],
    ["p=-6dB", "p=0.5011872336272722"],
    ["peak=500m", "peak=0.5"],
    ["e=6/2", "e=3"],
    ["compression=sqrt(16)", "compression=4"],
    ["t=1/10", "t=0.1"],
    ["raise=1/100", "raise=0.01"],
    ["f=-40dB", "f=0.01"],
    ["1/2:6/2:sqrt(16):1/10:1/100:-40dB", "0.5:3:4:0.1:0.01:0.01"]
  ] as const) {
    it(`speechnorm evaluates ${expression} like ${literal} (${graph ? "graph" : "simple"})`, async () => {
      const decimal = await run(literal, graph);
      assert.equal(decimal.result.exitCode, 0, decimal.stderr);
      const evaluated = await run(expression, graph);
      assert.equal(evaluated.result.exitCode, 0, evaluated.stderr);
      assert.equal(evaluated.output.length, 4097 * 2);
      assert.deepEqual(evaluated.output, decimal.output);
    });
  }

  for (const option of [
    "p=0b1", "p=0o1", "peak=0b1", "peak=0o1", "0b1", "0o1",
    "p=1/", "p=1/0", "p=0/0", "p=2/1", "p=-1/2", "p=1dB",
    "e=1/2", "e=51/1", "compression=1/2", "compression=51/1",
    "t=-1/10", "t=2/1", "r=-1/10", "r=2/1", "fall=-1/10", "fall=2/1"
  ]) {
    it(`speechnorm rejects ${option} without replacing output (${graph ? "graph" : "simple"})`, async () => {
      const { result, stderr, output } = await run(option, graph);
      assert.equal(result.exitCode, 1, stderr);
      assert.ok(stderr.includes("speechnorm:"), stderr);
      assert.equal(output.toString(), "sentinel");
    });
  }
}
