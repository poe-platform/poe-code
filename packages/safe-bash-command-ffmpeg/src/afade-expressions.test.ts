import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

async function run(options: string, graph: boolean) {
  const fs = Volume.fromJSON({ "/out.pcm": "KEEP" });
  fs.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000,
    channels: [new Float64Array(16).fill(12000 / 32768)] }));
  let stderr = "";
  const filter = `afade=${options}`;
  const result = await createFfmpegCommand().execute({
    args: ["-y", "-i", "/in.wav", ...(graph
      ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"]
      : ["-af", filter]), "-c:a", "pcm_s16le", "-f", "s16le", "/out.pcm"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return fs.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { fs.writeFileSync(path, bytes); },
      async stat(path: string) { return fs.statSync(path); }
    },
    stdin: (async function* () {})(), stdout: { async write() {} },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  return { ...result, stderr, output: fs.readFileSync("/out.pcm") as Buffer };
}

for (const graph of [false, true]) {
  for (const [expression, literal] of [
    ["ns=4:unity=1/2", "ns=4:unity=0.5"],
    ["ns=2+2", "ns=4"],
    ["ns=PI", "ns=3"],
    ["nb_samples=E", "ns=3"],
    ["nb_samples=PHI", "ns=2"],
    ["start_sample=1+1:nb_samples=sqrt(16)", "ss=2:ns=4"],
    ["ss=PI:ns=4:silence=1/4:unity=3/4", "ss=3:ns=4:silence=0.25:unity=0.75"],
    ["in:1+1:2*2:0:0:tri:1/4:1/2", "in:2:4:0:0:tri:0.25:0.5"],
    ["ns=1.5", "ns=2"],
    ["ns=2.5", "ns=2"],
    ["ns=3.5", "ns=4"],
    ["ss=2.5:ns=4", "ss=2:ns=4"],
    ["ss=3.5:ns=4", "ss=4:ns=4"],
    ["ns=4:silence=0/2:unity=2/2", "ns=4:silence=0:unity=1"],
    ["ss=2+2:ns=8/2:st=250us:d=500us", "ss=2:ns=4"]
  ] as const) {
    it(`afade evaluates ${expression} like ${literal} (${graph ? "graph" : "simple"})`, async () => {
      const expected = await run(literal, graph);
      const actual = await run(expression, graph);
      assert.equal(expected.exitCode, 0, expected.stderr);
      assert.equal(actual.exitCode, 0, actual.stderr);
      assert.equal(actual.output.length, 32);
      assert.deepEqual(actual.output, expected.output);
    });
  }

  for (const option of [
    "unity=2", "unity=3/2", "silence=-1/4", "silence=2/1", "ns=0", "ns=1-1",
    "ns=0.9", "ss=-1/4", "ns=9007199254740992", "ss=9007199254740992",
    "unity=1/0", "silence=0/0", "ns=1/0", "ss=0/0", "ns=2+", "unity=",
    "ns=unknown", "st=1/2", "start_time=PI", "d=1/2", "duration=PI"
  ]) {
    it(`afade rejects ${option} without replacing output (${graph ? "graph" : "simple"})`, async () => {
      const result = await run(option, graph);
      assert.equal(result.exitCode, 1, result.stderr);
      assert.ok(result.stderr.includes("afade:"), result.stderr);
      assert.equal(result.output.toString(), "KEEP");
    });
  }
}
