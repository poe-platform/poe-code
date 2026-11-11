import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const samples = [0, 0, 0, 5000, 4000, -4000, -5000, 0, 0, 0, 0,
  8000, -8000, 9000, -7000, 0, 0, 0, 0, 0, 0, 1000, 0, 0];
const input = Buffer.alloc(samples.length * 2);
samples.forEach((sample, i) => input.writeInt16LE(sample, i * 2));

async function run(filter: string, graph: boolean) {
  const volume = Volume.fromJSON({ "/in.pcm": input, "/out.pcm": "KEEP" });
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-y", "-v", "error", "-f", "s16le", "-ar", "1000", "-ac", "1", "-i", "/in.pcm",
      ...(graph ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
      "-f", "s16le", "/out.pcm"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(), stdout: { async write() {} },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  return { result, stderr, output: volume.readFileSync("/out.pcm") as Buffer };
}

// Native FFmpeg 7.0.2 reference PCM, including independent draws within an expression.
const audible = [0, 0, 0, 5000, 4000, -4000, -5000, 8000, -8000, 9000, -7000];
const thresholds = [
  { expression: "0.0625", start: samples.slice(3), stop: audible },
  { expression: "randomi(0,1,1)/16", start: samples.slice(3), stop: audible },
  { expression: "random(0)/16", start: samples.slice(3), stop: [...audible, 1000] },
  { expression: "random(0)/2", start: samples.slice(3), stop: audible },
  { expression: "(random(0)+random(0))/2", start: [], stop: samples },
  { expression: "st(0,42);random(0)/2", start: samples.slice(13), stop: samples.slice(0, 14) }
];

for (const graph of [false, true]) {
  for (const phase of ["start", "stop"] as const) {
    for (const { expression, ...expected } of thresholds) {
      it(`evaluates ${phase}_threshold=${expression} (graph=${graph})`, async () => {
        const filter = `silenceremove=${phase}_periods=${phase === "start" ? 1 : -1}:window=0:${phase}_threshold='${expression}'`;
        const { result, stderr, output } = await run(filter, graph);
        assert.equal(result.exitCode, 0, stderr);
        assert.equal(stderr, "");
        assert.deepEqual(Array.from({ length: output.length / 2 }, (_, i) => output.readInt16LE(i * 2)), expected[phase]);
      });
    }

    it(`evaluates a runtime random ${phase}_threshold (graph=${graph})`, async () => {
      const filter = `asetnsamples=n=3:p=0,asendcmd=c='0.003 silenceremove@trim ${phase}_threshold random(0)/16',`
        + `silenceremove@trim=${phase}_periods=${phase === "start" ? 1 : -1}:window=0:${phase}_threshold=${phase === "start" ? 1 : 0}`;
      const { result, stderr, output } = await run(filter, graph);
      assert.equal(result.exitCode, 0, stderr);
      assert.equal(stderr, "");
      assert.deepEqual(Array.from({ length: output.length / 2 }, (_, i) => output.readInt16LE(i * 2)),
        phase === "start" ? samples.slice(3) : [...audible, 1000]);
    });

    for (const [expression, exitCode] of [["randomi(0,1,1)*-1", 222], ["random(0,1)", 234]] as const) {
      it(`rejects ${phase}_threshold=${expression} without replacing output (graph=${graph})`, async () => {
        const { result, output } = await run(
          `silenceremove=${phase}_periods=1:window=0:${phase}_threshold='${expression}'`, graph);
        assert.equal(result.exitCode, exitCode);
        assert.equal(output.toString(), "KEEP");
      });
    }
  }
}
