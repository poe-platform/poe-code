import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

for (const graph of [false, true]) {
  it(`aexciter scheduling options preserve PCM (${graph ? "graph" : "simple"})`, async () => {
    const baseline = await run("aexciter", graph);
    assert.equal(baseline.result.exitCode, 0, baseline.stderr);
    assert.equal(baseline.output.length, 512);
    for (const option of [
      "threads=1", "extra_hw_frames=1", "threads=0:extra_hw_frames=-1",
      "threads=2147483647:extra_hw_frames=2147483647",
      "threads=default:extra_hw_frames=default", "threads=min:extra_hw_frames=min",
      "threads=1+1:extra_hw_frames=2-1", "threads=1.5:extra_hw_frames=0.5",
      "threads=1:threads=2:extra_hw_frames=1", "amount=1:threads=1:extra_hw_frames=1",
      "1:1:1:8.5:0:7500:9999:0:threads=1:extra_hw_frames=1"
    ]) {
      const actual = await run(`aexciter=${option}`, graph);
      assert.equal(actual.result.exitCode, 0, `${option}: ${actual.stderr}`);
      assert.equal(actual.stderr, "", option);
      assert.deepEqual(actual.output, baseline.output, option);
    }
  });

  it(`aexciter rejects invalid scheduling options without replacing output (${graph ? "graph" : "simple"})`, async () => {
    for (const option of [
      "threads=-1", "threads=2147483648", "threads=", "threads=bogus",
      "threads=NaN", "threads=Infinity", "threads=bogus:threads=1",
      "extra_hw_frames=-2", "extra_hw_frames=2147483648", "extra_hw_frames=",
      "extra_hw_frames=bogus", "extra_hw_frames=NaN", "threads=1:unknown=1"
    ]) {
      const actual = await run(`aexciter=${option}`, graph);
      assert.notEqual(actual.result.exitCode, 0, option);
      assert.ok(actual.stderr.includes("aexciter:"), actual.stderr);
      assert.equal(actual.output.toString(), "keep", option);
    }
  });
}

async function run(filter: string, graph: boolean) {
  const input = encodeWav({ sampleRate: 48000, channels: [
    Float64Array.from({ length: 256 }, (_, i) => (i % 2 ? -10000 : 10000) / 32768)
  ] });
  const volume = Volume.fromJSON({ "/in.wav": Buffer.from(input), "/out.pcm": "keep" });
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-y", "-v", "error", "-i", "/in.wav", ...(graph
      ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
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
  assert.deepEqual(volume.readFileSync("/in.wav"), Buffer.from(input));
  return { result, stderr, output: volume.readFileSync("/out.pcm") as Buffer };
}
