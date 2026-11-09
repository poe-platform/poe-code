import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

// Recreates the 8 kHz PCM16 threshold WAV used for native FFmpeg 7.0.2 references.
const samples = Float64Array.from({ length: 4097 }, (_, i) =>
  [8192, -8192, 4000, -4000, 8193, -8193, 26000, -30000][i % 8]! / 32768);
async function run(filter: string, graph: boolean, channels = [samples]) {
  const fs = Volume.fromJSON({ "/in.wav": Buffer.from(encodeWav({ sampleRate: 8000, channels })), "/out.pcm": "KEEP" });
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-y", "-i", "/in.wav", ...(graph
      ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"]
      : ["-af", filter]), "-f", "s16le", "/out.pcm"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: { async readFile(path: string) { return fs.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { fs.writeFileSync(path, bytes); },
      async stat(path: string) { return fs.statSync(path); } },
    stdin: (async function* () {})(), stdout: { async write() {} },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  return { result, stderr, output: fs.readFileSync("/out.pcm") as Buffer };
}

for (const graph of [false, true]) {
  for (const [filter, hash] of [
    ["speechnorm=p=0.5:enable=gte(t\\,0.1)", "6338e8f4eb7b2d20eead928b346ece9d5ad6748dc9d2a41b61b96490e42873cc"],
    ["speechnorm=p=0.5:enable=mod(n\\,2)", "b19afe0b204ee89064e7d7b9f19ecaff37d0b50ec31b2f98de98e123b45cab7a"],
    ["asetpts=PTS+800,speechnorm=p=0.5:enable='gte(t,0.1)'", "66a4b0b7de7799732805540c005c3f2f26f438ce0901c118ad4c50c195f121ab"],
    ["asetnsamples=n=200:p=0,speechnorm=p=0.5:enable=gte(t\\,0.1)", "7a96ff90dfc709e8a40558b947f2e6233dbcbf8ac520c411d37897b817a97fe7"]
  ] as const) {
    it(`matches native speechnorm timeline PCM for ${filter} (${graph ? "graph" : "simple"})`, async () => {
      const { result, stderr, output } = await run(filter, graph);
      assert.equal(result.exitCode, 0, stderr);
      assert.equal(output.length, 4097 * 2);
      assert.equal(createHash("sha256").update(output).digest("hex"), hash);
      if (filter === "speechnorm=p=0.5:enable=gte(t\\,0.1)") {
        assert.deepEqual([0, 511, 512, 1024].map(i => output.readInt16LE(i * 2)), [8192, -30000, 4482, 4482]);
        assert.notDeepEqual(output, (await run("anull", graph)).output);
        assert.notDeepEqual(output, (await run("speechnorm=p=0.5", graph)).output);
      }
    });
  }

  for (const enable of ["0", "0.25", "1", "-1"]) {
    it(`speechnorm enable=${enable} matches constant gating (${graph ? "graph" : "simple"})`, async () => {
      const expected = await run(Math.abs(Number(enable)) >= 0.5 ? "speechnorm=p=0.5" : "anull", graph);
      assert.equal(expected.result.exitCode, 0, expected.stderr);
      const actual = await run(`speechnorm=p=0.5:enable=${enable}`, graph);
      assert.equal(actual.result.exitCode, 0, actual.stderr);
      assert.deepEqual(actual.output, expected.output);
    });
  }

  for (const enable of ["", "unknown", "gte(t)", "1+"]) {
    it(`rejects invalid speechnorm enable=${enable} without replacing output (${graph ? "graph" : "simple"})`, async () => {
      const { result, stderr, output } = await run(`speechnorm=enable=${enable}`, graph);
      assert.notEqual(result.exitCode, 0, stderr);
      assert.ok(stderr.includes("speechnorm"), stderr);
      assert.equal(output.toString(), "KEEP");
    });
  }
}

for (const [count, size, hash] of [
  [1, 0, "26bec8152b4db0febccf26d490a0dfe2866924ff9d5c3a7cb039c09a5af04e1e"],
  [1, 80, "eb8bd4d07b242a977ce59c738cbb39973ba562be81d21e28322d83d21f2424e7"],
  [2, 0, "7d0d38a74510cdea1f2040d3c90dd6aef001cf74acb913e07cd5c770e2573945"],
  [2, 80, "e424cb3440a9fb20d2c991a50f7cc00e472346842b55991b218be7efb3b69cfd"]
] as const) for (const graph of [false, true]) {
  it(`matches native speechnorm lookahead over long periods (${count} channels, frame size ${size}, graph ${graph})`, async () => {
    const channels = Array.from({ length: count }, (_, c) => Float64Array.from({ length: 4097 }, (_, i) =>
      (c === 0 ? i === 2400 ? 29000 : 500 : i % 1400 < 700 ? 1000 : -1000) / 32768));
    const filter = `${size ? `asetnsamples=n=${size}:p=0,` : ""}speechnorm=p=0.5:enable=mod(n\\,2)`;
    const { result, stderr, output } = await run(filter, graph, channels);
    assert.equal(result.exitCode, 0, stderr);
    assert.equal(output.length, 4097 * count * 2);
    assert.equal(createHash("sha256").update(output).digest("hex"), hash);
  });
}
