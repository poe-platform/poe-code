import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { MediaBudgetTracker } from "@poe-code/mp4-ast";
import { smoothAudio } from "./audio-adynamicsmooth.js";
import { createFfmpegCommand } from "./index.js";

async function run(filter: string, graph = false) {
  const fs = createMemoryFileSystem();
  const input = Buffer.alloc(128);
  for (let i = 0; i < 32; i++) {
    input.writeInt16LE((i * 1237) % 30001 - 15000, i * 4);
    input.writeInt16LE(10000 - (i * 937) % 20001, i * 4 + 2);
  }
  await fs.writeFile("/in.raw", input);
  await fs.writeFile("/out.raw", Buffer.from("KEEP"));
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-v", "error", "-y", "-f", "s16le", "-ar", "48000", "-ac", "2", "-i", "/in.raw",
      ...(graph ? ["-filter_complex", `[0:a]${filter}[o]`, "-map", "[o]"] : ["-af", filter]),
      "-c:a", "pcm_s16le", "-f", "s16le", "/out.raw"],
    command: "ffmpeg", cwd: "/", env: {}, fs, signal: new AbortController().signal,
    stdin: (async function* () {})(), stdout: { async write() {} },
    stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } }
  });
  return { result, stderr, output: Buffer.from(await fs.readFile("/out.raw")) };
}

// Native FFmpeg 7.0.2 stereo PCM16 reference hashes.
for (const graph of [false, true]) {
  for (const [filter, hash] of [
    ["anull", "790d5eb4b0a43f0c07ed8b50e5ce82d841604be5d004bcb97fc51d0ebb467358"],
    ["adynamicsmooth=basefreq=400:sensitivity=1", "bca2ca82544436eed71069057953c0efb87f1a63a0531a3c96f4962b2d4bedad"],
    ["adynamicsmooth=basefreq=400:sensitivity=3", "4a22dfd233363b0bc93e757e663cb8f714ebd48b8b872e0ac011ed90903e694f"],
    ["adynamicsmooth@sm=3:400", "4a22dfd233363b0bc93e757e663cb8f714ebd48b8b872e0ac011ed90903e694f"]
  ]) {
    it(`matches native ${filter}, graph=${graph}`, async () => {
      const { result, stderr, output } = await run(filter!, graph);
      assert.equal(result.exitCode, 0, stderr);
      assert.equal(output.length, 128);
      assert.equal(createHash("sha256").update(output).digest("hex"), hash);
    });
  }
}

for (const options of ["basefreq=1", "basefreq=1000001", "sensitivity=-1", "sensitivity=1000001", "unknown=1"]) {
  it(`rejects ${options} without replacing output`, async () => {
    const { result, output } = await run(`adynamicsmooth=${options}`);
    assert.notEqual(result.exitCode, 0);
    assert.equal(output.toString(), "KEEP");
  });
}

it("applies base frequency and supports timeline bypass", async () => {
  const low = await run("adynamicsmooth=basefreq=400:sensitivity=1");
  const high = await run("adynamicsmooth=basefreq=800:sensitivity=1");
  assert.equal(high.result.exitCode, 0, high.stderr);
  assert.notDeepEqual(high.output, low.output);
  const bypass = await run("adynamicsmooth=enable=0");
  assert.equal(bypass.result.exitCode, 0, bypass.stderr);
  assert.deepEqual(bypass.output, (await run("anull")).output);
});

it("preserves channel history across frames and honors resource limits", async () => {
  const channels = [Float64Array.from({ length: 8192 }, (_, i) => Math.sin(i)), new Float64Array(8192)];
  const full = [{ start: 0, end: 8192, pts: 0 }];
  const split = [{ start: 0, end: 4096, pts: 0 }, { start: 4096, end: 8192, pts: 4096 }];
  const filter = "adynamicsmooth=basefreq=400";
  const actual = await smoothAudio(channels, 48000, filter, split, new MediaBudgetTracker());
  assert.deepEqual(actual, await smoothAudio(channels, 48000, filter, full, new MediaBudgetTracker()));
  assert.deepEqual(actual[1], channels[1]);
  await assert.rejects(smoothAudio(channels, 48000, filter, full,
    new MediaBudgetTracker({ maxMemoryBytes: 64 })), /maxMemoryBytes/);
  await assert.rejects(smoothAudio(channels, 48000, filter, full,
    new MediaBudgetTracker(), AbortSignal.abort()));
});
