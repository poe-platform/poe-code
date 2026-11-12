import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { MediaBudgetTracker } from "@poe-code/mp4-ast";
import { passAudio } from "./audio-pass.js";
import { createFfmpegCommand } from "./index.js";

const input = Array.from({ length: 23 }, (_, i) => 1000 * (i + 1) * (-1) ** i);
const bytes = encodeWav({ sampleRate: 8000, channels: [Float64Array.from(input, value => value / 32768)] });

// Complete PCM16 streams from FFmpeg 7.0.2. Zero gain still runs the biquad.
for (const [filter, expected] of [
  ["equalizer", input],
  ["equalizer=g=6", input],
  ["equalizer=f=1000:t=s:w=0.5:g=6", [1335, -2356, 3227, -4341, 5276, -6300, 7299, -8292, 9298, -10294, 11296, -12296, 13295, -14296, 15296, -16296, 17296, -18296, 19296, -20296, 21296, -22296, 23296]],
  ["equalizer=f=1000:t=q:w=1:g=6,volume=1", [1199, -2173, 3083, -4201, 5122, -6141, 7167, -8126, 9156, -10146, 11139, -12153, 13142, -14146, 15148, -16143, 17148, -18146, 19145, -20147, 21145, -22146, 23146]],
  ["equalizer=f=1000:g=6", [1199, -2173, 3083, -4200, 5121, -6140, 7166, -8125, 9156, -10146, 11139, -12153, 13141, -14146, 15147, -16143, 17147, -18145, 19145, -20146, 21145, -22146, 23146]],
  ["equalizer=f=1000:t=q:w=1:g=6", [1199, -2173, 3083, -4200, 5121, -6140, 7166, -8125, 9156, -10146, 11139, -12153, 13141, -14146, 15147, -16143, 17147, -18145, 19145, -20146, 21145, -22146, 23146]],
  ["equalizer=f=1000:t=q:w=1:g=-6", [833, -1824, 2888, -3831, 4864, -5852, 6852, -7856, 8852, -9854, 10853, -11853, 12854, -13853, 14854, -15854, 16854, -17854, 18854, -19854, 20854, -21854, 22854]],
  ["equalizer=f=1000:t=q:w=1:g=0", [1000, -1999, 3000, -3999, 5000, -6000, 6999, -7999, 9000, -10000, 11000, -11999, 13000, -14000, 14999, -16000, 17000, -17999, 19000, -19999, 21000, -22000, 23000]],
  ["equalizer@voice=frequency=1000:width_type=q:width=1:gain=6", [1199, -2173, 3083, -4200, 5121, -6140, 7166, -8125, 9156, -10146, 11139, -12153, 13141, -14146, 15147, -16143, 17147, -18145, 19145, -20146, 21145, -22146, 23146]],
  ["bandpass=f=1000:t=q:w=1", [261, -249, 136, -260, 185, -204, 220, -194, 213, -205, 205, -209, 205, -207, 207, -206, 207, -206, 207, -207, 207, -207, 207]],
] as const) {
  for (const graph of [false, true]) it(`matches native PCM for ${filter} (graph=${graph})`, async () => {
    const { result, stderr, samples } = await run(filter, graph);
    assert.equal(result.exitCode, 0, stderr);
    assert.equal(stderr, "");
    assert.deepEqual(samples, expected);
  });
}

for (const option of ["g=NaN", "gain=901", "gain=-901", "g=", "f=-1", "w=-1", "t=invalid", "p=1", "unknown=1"]) {
  it(`rejects equalizer ${option} without overwriting output`, async () => {
    const { fs, result, stderr, samples } = await run(`equalizer=${option}`, false, "/out.raw");
    assert.notEqual(result.exitCode, 0);
    assert.ok(stderr.includes("equalizer"), stderr);
    assert.deepEqual(samples, []);
    assert.equal(fs.readFileSync("/out.raw", "utf8"), "KEEP");
  });
}

it("bounds equalizer memory and honors cancellation", async () => {
  await assert.rejects(passAudio([new Float64Array(64)], 8000, "equalizer=f=1000:g=6", "s16",
    new MediaBudgetTracker({ maxMemoryBytes: 64 })), /maxMemoryBytes/);
  await assert.rejects(passAudio([new Float64Array(64)], 8000, "equalizer=f=1000:g=6", "s16",
    new MediaBudgetTracker(), AbortSignal.abort()));
});

async function run(filter: string, graph = false, output = "pipe:1") {
  const fs = Volume.fromJSON({ "/in.wav": Buffer.from(bytes), "/out.raw": "KEEP" });
  let stderr = "";
  const chunks: Buffer[] = [];
  const result = await createFfmpegCommand().execute({
    args: ["-hide_banner", "-loglevel", "error", "-y", "-i", "/in.wav", ...(graph
      ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
      "-c:a", "pcm_s16le", "-f", "s16le", output],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return fs.readFileSync(path); },
      async writeFile(path: string, data: Uint8Array) { fs.writeFileSync(path, data); },
      async stat(path: string) { return fs.statSync(path); }
    },
    stdin: (async function* () {})(),
    stdout: { async write(data: Uint8Array) { chunks.push(Buffer.from(data)); } },
    stderr: { async write(data: Uint8Array) { stderr += new TextDecoder().decode(data); } }
  } as never);
  const pcm = Buffer.concat(chunks);
  const samples = Array.from({ length: pcm.length / 2 }, (_, i) => pcm.readInt16LE(i * 2));
  return { fs, result, stderr, samples };
}
