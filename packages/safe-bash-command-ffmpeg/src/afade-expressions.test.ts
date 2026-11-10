import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

async function run(options: string, graph: boolean, samples = new Float64Array(16).fill(12000 / 32768)) {
  const fs = Volume.fromJSON({ "/out.pcm": "KEEP" });
  fs.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000,
    channels: [samples] }));
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
    ["c=0+1:ns=4", "c=qsin:ns=4"],
    ["curve=qsin+1:ns=4", "c=esin:ns=4"],
    ["curve=-1/2:ns=4", "c=tri:ns=4"],
    ["curve=1.5:ns=4", "c=esin:ns=4"],
    ["curve=2.5:ns=4", "c=esin:ns=4"],
    ["t=1-1:ns=4", "t=in:ns=4"],
    ["type=in+1:ns=4", "t=out:ns=4"],
    ["type=1/2:ns=4", "t=in:ns=4"],
    ["type=3/4:ns=4", "t=out:ns=4"],
    ["1-1:0:4:0:0:0+1", "in:0:4:0:0:qsin"],
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
    "c=23-0", "curve=-1.1", "c=22.1", "c=unknown", "c=1/0", "c=0/0", "c=",
    "t=2-0", "type=-0.1", "t=1.1", "type=unknown", "t=1/0", "t=0/0", "t=",
    "unity=2", "unity=3/2", "silence=-1/4", "silence=2/1", "ns=0", "ns=1-1",
    "ns=0.9", "ss=-1/4", "ns=18446744073709551616", "ss=18446744073709551616",
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

// Native FFmpeg 7.0.2 hashes for the 3173-sample PCM16 reproduction.
for (const [options, hash] of [
  ["c=0+1:ns=900", "41b5795fc8c9379cdc9587c3c901301ed383e5b439fd478faf53a7f544221a7b"],
  ["c=qsin:ns=900", "41b5795fc8c9379cdc9587c3c901301ed383e5b439fd478faf53a7f544221a7b"],
  ["t=1-1:ns=900", "0e18cde688299d4e9ddd19e7132b19ebf546c41ec789baf732250b44fbcf567a"],
  ["t=in:ns=900", "0e18cde688299d4e9ddd19e7132b19ebf546c41ec789baf732250b44fbcf567a"]
]) {
  it(`afade ${options} matches native PCM bytes`, async () => {
    const samples = Float64Array.from({ length: 3173 }, (_, i) => ((i * 179 % 50001) - 25000) / 32768);
    const result = await run(options!, false, samples);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.output.length, 6346);
    assert.equal(createHash("sha256").update(result.output).digest("hex"), hash);
  });
}
