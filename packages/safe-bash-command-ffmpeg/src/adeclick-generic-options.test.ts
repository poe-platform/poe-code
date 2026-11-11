import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

for (const name of ["adeclick", "adeclip"]) for (const graph of [false, true]) {
  it(`${name} accepts generic options without changing PCM (${graph ? "graph" : "simple"})`, async () => {
    // FFmpeg 7.0.2: mono PCM16 [-600, -500, 30000, -300] at 8000 Hz.
    for (const options of [
      "", "threads=1", "thread_type=slice", "extra_hw_frames=0",
      "threads=1:thread_type=slice:extra_hw_frames=0",
      "threads=0:thread_type=none:extra_hw_frames=-1",
      "threads=max:thread_type=4294967295:extra_hw_frames=max",
      "threads=default:extra_hw_frames=min", "threads=1+1:extra_hw_frames=2-1",
      "threads=1.5:extra_hw_frames=0.5", "thread_type=+slice", "thread_type=all-slice",
      "threads=1:threads=2", "w=55:threads=1:o=75", "threads=1:method=add",
      `55:75:${name === "adeclip" ? "8:10:1000" : "2:2:2"}:add:threads=1`,
      " threads = 1 : thread_type = slice : extra_hw_frames = 0"
    ]) {
      const actual = await run(name, options, graph);
      assert.equal(actual.result.exitCode, 0, `${options}: ${actual.stderr}`);
      assert.equal(actual.output.toString("hex"), "fefffdff1101fcff", options);
    }
  });

  it(`${name} rejects invalid generic options without replacing output (${graph ? "graph" : "simple"})`, async () => {
    for (const options of [
      "threads=-1", "threads=2147483648", "threads=", "threads=bogus", "threads=NaN",
      "thread_type=bogus", "thread_type=", "thread_type=0.5", "thread_type=4294967296",
      "extra_hw_frames=-2", "extra_hw_frames=2147483648", "extra_hw_frames=",
      "threads=-1:threads=1", "thread_type=bogus:thread_type=slice",
      "extra_hw_frames=-2:extra_hw_frames=0", "unknown=1", "threads=1:unknown=1"
    ]) {
      const actual = await run(name, options, graph);
      assert.notEqual(actual.result.exitCode, 0, options);
      assert.ok(actual.stderr.includes(`${name}:`), actual.stderr);
      assert.equal(actual.output.toString(), "keep", options);
    }
  });
}

async function run(name: string, options: string, graph: boolean) {
  const input = encodeWav({ sampleRate: 8000,
    channels: [Float64Array.from([-600, -500, 30000, -300], value => value / 32768)] });
  const volume = Volume.fromJSON({ "/in.wav": Buffer.from(input), "/out.pcm": "keep" });
  const filter = `${name}${options ? `=${options}` : ""}`;
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-y", "-v", "error", "-i", "/in.wav",
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
  assert.deepEqual(volume.readFileSync("/in.wav"), Buffer.from(input));
  return { result, stderr, output: volume.readFileSync("/out.pcm") as Buffer };
}
