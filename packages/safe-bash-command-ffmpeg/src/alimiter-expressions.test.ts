import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

async function run(options: string, graph: boolean) {
  const fs = Volume.fromJSON({ "/out.pcm": "KEEP" });
  fs.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000, channels: [
    Float64Array.from({ length: 3087 }, (_, i) => Math.sin(i / 8) * (i < 1024 ? 0.1 : 0.75))
  ] }));
  let stderr = "";
  const filter = `alimiter=${options}`;
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
    ["limit=-12dB", "limit=0.251188643150958"],
    ["limit=1/4", "limit=0.25"],
    ["level_in=1.5dB", "level_in=1.1885022274370185"],
    ["level_out=-6dB", "level_out=0.5011872336272722"],
    ["level_in=sqrt(4)", "level_in=2"],
    ["level_out=1/2", "level_out=0.5"],
    ["level_in=st(0\\,0.5)", "level_in=0.5"],
    ["level_in='st(0,0.5)'", "level_in=0.5"],
    ["level_out='st(9,0.5);ld(9)'", "level_out=0.5"],
    ["level_in='st(0,0.5)':level_out='ld(0)+1'", "level_in=0.5:level_out=1"],
    ["attack=2+3", "attack=5"],
    ["release=1k/2", "release=500"],
    ["asc_level=1/4", "asc_level=0.25"],
    ["1/2:1/2:1/4:2+3:1k/2:0:1/4", "0.5:0.5:0.25:5:500:0:0.25"]
  ]) {
    it(`alimiter evaluates ${expression} like ${literal} (${graph ? "graph" : "simple"})`, async () => {
      const decimal = await run(`${literal}:level=0:latency=1`, graph);
      assert.equal(decimal.result.exitCode, 0, decimal.stderr);
      const evaluated = await run(`${expression}:level=0:latency=1`, graph);
      assert.equal(evaluated.result.exitCode, 0, evaluated.stderr);
      assert.equal(evaluated.output.length, 3087 * 2);
      assert.deepEqual(evaluated.output, decimal.output);
    });
  }

  for (const [option, exitCode] of [
    ...["release=0b10", "release=0o10", "limit=1/", "limit=1/0", "limit=0/0",
      "level=1/1", "latency=0dB", "asc=0/1"].map(option => [option, 234] as const),
    ...["limit=-30dB", "limit=1dB", "limit=1/32", "limit=2/1",
      "level_in=1/128", "level_in=65/1", "level_out=1/128", "level_out=65/1",
      "attack=1/100", "attack=81/1", "release=1/2", "release=8001/1",
      "asc_level=-1/2", "asc_level=2/1", "level_in='st(0,65)'", "level_out='ld(0)'"].map(option => [option, 222] as const)
  ]) {
    it(`alimiter rejects ${option} without replacing output (${graph ? "graph" : "simple"})`, async () => {
      const { result, stderr, output } = await run(option, graph);
      assert.equal(result.exitCode, exitCode, stderr);
      assert.ok(stderr.includes("alimiter:"), stderr);
      assert.equal(output.toString(), "KEEP");
    });
  }
}
