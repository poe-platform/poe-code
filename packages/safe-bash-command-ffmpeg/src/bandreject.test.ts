import assert from "node:assert/strict";
import { it } from "node:test";
import { encodeWav } from "@poe-code/audio-ast";
import { MediaBudgetTracker } from "@poe-code/mp4-ast";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { passAudio } from "./audio-pass.js";
import { createFfmpegCommand } from "./index.js";

const samples = Array.from({ length: 23 }, (_, i) => 1000 * (i + 1) * (-1) ** i);
// Complete PCM16 output from native FFmpeg 7.0.2 for the 8 kHz mono fixture.
const rejectedQ = [839, -1927, 2899, -3883, 4927, -5869, 6929, -7876, 8918, -9889, 10905, -11899,
  12897, -13905, 14895, -15905, 16896, -17903, 18898, -19901, 20900, -21900, 22901];
const rejectedHz = [945, -1986, 2963, -3966, 4981, -5953, 6989, -7951, 8985, -9959, 10974, -11971,
  12963, -13980, 14958, -15982, 16960, -17977, 18966, -19969, 20974, -21963, 22977];

for (const [filter, expected] of [
  ["bandreject=f=500:t=q:w=1", rejectedQ],
  ["bandreject=f=500:t=h:w=150", rejectedHz],
  ["asetnsamples=n=5:p=0,bandreject=f=500:t=q:w=1", rejectedQ],
  ["bandreject@notch=frequency=500:width_type=h:width=150", rejectedHz],
  ["bandreject=500:w=1", rejectedQ],
  ["bandreject=f=500:w=1:mix=0", samples],
  ["bandpass=f=500:t=q:w=1", [160, -72, 100, -116, 72, -130, 70, -123, 81, -110, 94, -100,
    102, -94, 104, -94, 103, -96, 101, -98, 99, -99, 98]]
] as const) {
  for (const graph of [false, true]) it(`matches native PCM: ${filter}, graph=${graph}`, async () => {
    const { result, stderr, output } = await run(filter, graph);
    assert.equal(result.exitCode, 0, stderr);
    assert.equal(stderr, "");
    assert.deepEqual(Array.from({ length: output.length / 2 }, (_, i) => output.readInt16LE(i * 2)), expected);
  });
}

for (const option of ["f=-1", "w=-1", "t=invalid", "p=1", "poles=2", "unknown=1"]) {
  it(`rejects bandreject ${option} without replacing output`, async () => {
    const { fs, result, stderr, output } = await run(`bandreject=${option}`, false, "/out.raw");
    assert.notEqual(result.exitCode, 0);
    assert.ok(stderr.includes("bandreject"), stderr);
    assert.equal(output.length, 0);
    assert.equal(new TextDecoder().decode(await fs.readFile("/out.raw")), "KEEP");
  });
}

it("bounds bandreject memory and honors cancellation", async () => {
  await assert.rejects(passAudio([new Float64Array(64)], 8000, "bandreject", "s16",
    new MediaBudgetTracker({ maxMemoryBytes: 64 })), /maxMemoryBytes/);
  await assert.rejects(passAudio([new Float64Array(64)], 8000, "bandreject", "s16",
    new MediaBudgetTracker(), AbortSignal.abort()));
});

async function run(filter: string, graph = false, destination = "pipe:1") {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/in.wav", encodeWav({ sampleRate: 8000, channels: [Float64Array.from(samples, sample => sample / 32768)] }));
  await fs.writeFile("/out.raw", new TextEncoder().encode("KEEP"));
  const chunks: Uint8Array[] = [];
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-hide_banner", "-loglevel", "error", "-y", "-i", "/in.wav", ...(graph
      ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
      "-c:a", "pcm_s16le", "-f", "s16le", destination],
    command: "ffmpeg", cwd: "/", env: {}, fs, signal: new AbortController().signal,
    stdin: (async function* () {})(),
    stdout: { async write(chunk) { chunks.push(chunk.slice()); } },
    stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } }
  });
  return { fs, result, stderr, output: Buffer.concat(chunks) };
}
