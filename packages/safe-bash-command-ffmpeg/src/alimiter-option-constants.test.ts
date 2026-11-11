import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

const samples = [1000, -2000, 3000, -4000, 5000, -6000, 7000, -8000,
  9000, -10000, 11000, -12000, 13000, -14000, 15000, -16000];

async function run(options: string, graph: boolean) {
  const fs = Volume.fromJSON({ "/out.pcm": "KEEP" });
  fs.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000,
    channels: [Float64Array.from(samples, sample => sample / 32768)] }));
  let stderr = "";
  const filter = `alimiter=attack=0.5:level=0:${options}`;
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
  for (const options of ["level_out=default", "limit=max", "level_out=1", "limit=1"]) {
    it(`matches native limiter PCM for ${options} (${graph ? "graph" : "simple"})`, async () => {
      const { result, stderr, output } = await run(options, graph);
      assert.equal(result.exitCode, 0, stderr);
      assert.equal(stderr, "");
      assert.deepEqual(Array.from({ length: output.length / 2 }, (_, i) => output.readInt16LE(i * 2)),
        [0, 0, 0, ...samples.slice(0, -3)]);
    });
  }

  for (const [expression, literal] of [
    ["level_in=default/2", "level_in=0.5"],
    ["level_out=max/128", "level_out=0.5"],
    ["level_in=min", "level_in=0.015625"],
    ["level_out=min", "level_out=0.015625"],
    ["limit=min", "limit=0.0625"],
    ["limit=default/2", "limit=0.5"],
    ["attack=min*5", "attack=0.5"],
    ["attack=default", "attack=5"],
    ["attack=max", "attack=80"],
    ["release=min", "release=1"],
    ["release=default", "release=50"],
    ["release=max", "release=8000"],
    ["asc_level=min", "asc_level=0"],
    ["asc_level=default", "asc_level=0.5"],
    ["asc_level=max", "asc_level=1"],
    ["level_out=0.5:level_out=default", "level_out=1"],
    ["asc_level=none", "asc_level=0"],
    ["level_in=-all", "level_in=1"],
    ["limit=0.25,asetnsamples=n=4:p=0,asendcmd=c='0 alimiter@cap limit default',alimiter@cap=attack=0.5:level=0:limit=0.25",
      "limit=0.25,asetnsamples=n=4:p=0,asendcmd=c='0 alimiter@cap limit 1',alimiter@cap=attack=0.5:level=0:limit=0.25"]
  ] as const) {
    it(`resolves limiter ${expression} like ${literal} (${graph ? "graph" : "simple"})`, async () => {
      const control = await run(literal, graph);
      assert.equal(control.result.exitCode, 0, control.stderr);
      const actual = await run(expression, graph);
      assert.equal(actual.result.exitCode, 0, actual.stderr);
      assert.equal(actual.stderr, "");
      assert.deepEqual(actual.output, control.output);
    });
  }

  for (const options of ["limit=min/2", "level_out=max+1", "release=default/0", "level_out=DEFAULT", "level=default"]) {
    it(`rejects limiter ${options} without replacing output (${graph ? "graph" : "simple"})`, async () => {
      const { result, stderr, output } = await run(options, graph);
      assert.notEqual(result.exitCode, 0, stderr);
      assert.ok(stderr.includes("alimiter:"), stderr);
      assert.equal(output.toString(), "KEEP");
    });
  }
}
