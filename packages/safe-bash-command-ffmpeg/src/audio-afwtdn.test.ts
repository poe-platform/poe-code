import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { encodeWav } from "@poe-code/audio-ast";
import { it } from "node:test";
import { Volume } from "memfs";
import { MediaBudgetTracker, parseWav } from "@poe-code/mp4-ast";
import { denoiseWavelets } from "./audio-afwtdn.js";
import references from "./fixtures/afwtdn-native.json" with { type: "json" };
import { createFfmpegCommand } from "./index.js";

const input = readFileSync(new URL("./fixtures/afwtdn-noise.wav", import.meta.url));
const expected = parseWav(readFileSync(new URL("./fixtures/afwtdn-native.wav", import.meta.url))).tracks[0]!.decodedAudio!;

for (const graph of [false, true]) it(`afwtdn matches native PCM across all windows (graph=${graph})`, async () => {
  const { fs, result, stderr } = await run("afwtdn=sigma=0.12:levels=4:samples=1024", graph);
  assert.equal(result.exitCode, 0, stderr);
  const actual = parseWav(fs.readFileSync("/out.wav") as Buffer).tracks[0]!.decodedAudio!;
  assert.equal(actual.sampleRate, 16000);
  assert.equal(actual.channels, 1);
  assert.equal(actual.channelData[0]!.length, 8192);
  assert.deepEqual(actual.channelData, expected.channelData);
  const original = parseWav(input).tracks[0]!.decodedAudio!.channelData[0]!;
  assert.equal(actual.channelData[0]!.filter((sample, i) => sample !== original[i]).length, 8191);
  assert.equal(Math.max(...actual.channelData[0]!.map(sample => Math.abs(sample * 32768))), 7648);
});

it("preserves the original PCM without filtering", async () => {
  const { fs, result, stderr } = await run();
  assert.equal(result.exitCode, 0, stderr);
  assert.deepEqual(parseWav(fs.readFileSync("/out.wav") as Buffer).tracks[0]!.decodedAudio!.channelData,
    parseWav(input).tracks[0]!.decodedAudio!.channelData);
});

for (const graph of [false, true]) {
  for (const options of [
    "samples=512:levels=2:0.1:wavet=sym2",
    "samples=512:levels=2:wavet=sym2:sigma=0.1",
    ...["threads=1", "thread_type=slice", "extra_hw_frames=0",
      "threads=1:thread_type=slice:extra_hw_frames=0",
      "threads=default:thread_type=none:extra_hw_frames=min",
      "threads=1+1:thread_type=+slice:extra_hw_frames=2-1"
    ].map(option => `samples=512:levels=2:wavet=sym2:sigma=0.1:${option}`),
    "samples=512:0.1:2:sym2",
    "sigma=0:0.1:levels=2:samples=512:wavet=sym2",
    "samples=512:levels=2:0.1:wavet=sym2:sigma=0"
  ]) it(`resolves afwtdn shorthand independently of named options: ${options} (graph=${graph})`, async () => {
    const channels = [Float64Array.from({ length: 1200 }, (_, i) => ((i * 13129) % 30001 - 15000) / 32768)];
    const bytes = Buffer.from(encodeWav({ sampleRate: 8000, channels }));
    const { fs, result, stderr } = await run(`afwtdn=${options}`, graph, bytes);
    assert.equal(result.exitCode, 0, stderr);
    const samples = parseWav(fs.readFileSync("/out.wav") as Buffer).tracks[0]!.decodedAudio!.channelData[0]!;
    const pcm = Buffer.alloc(samples.length * 2);
    samples.forEach((sample, i) => pcm.writeInt16LE(sample * 32768, i * 2));
    assert.equal(pcm.length, 3054);
    // Native FFmpeg 7.0.2 output for the issue's deterministic PCM16 input.
    assert.equal(createHash("sha256").update(pcm).digest("hex"), options.endsWith("sigma=0")
      ? "3b580af95602a2b1d31c45cc2248683c1147cbc95ff260c92421f251b6bb1366"
      : "2f2ba9f7bee86dd971296640edace24e1665063b4b55e640804c503b7b4de795");
  });
}

async function run(filter?: string, graph = false, bytes = input) {
  const fs = Volume.fromJSON({ "/out.wav": "KEEP" });
  fs.writeFileSync("/in.wav", bytes);
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-y", "-v", "error", "-i", "/in.wav", ...(filter ? graph
      ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter] : []), "-c:a", "pcm_s16le", "/out.wav"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return fs.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { fs.writeFileSync(path, bytes); },
      async stat(path: string) { return fs.statSync(path); }
    },
    stdin: (async function* () {})(), stdout: { async write() {} },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  return { fs, result, stderr };
}

// Native FFmpeg 7.0.2 hashes of interleaved s16le PCM (not WAV headers).
const mono = Float64Array.from(parseWav(input).tracks[0]!.decodedAudio!.channelData[0]!);
for (const reference of references) it(`matches native ${reference.input}: ${reference.filter}`, async () => {
  const channels = reference.input === "short" ? [mono.slice(0, 777)]
    : reference.input === "stereo" ? [mono.slice(0, 1301), mono.slice(0, 1301).reverse()]
    : reference.input === "silence" ? [new Float64Array(1024)] : [mono];
  const { fs, result, stderr } = await run(reference.filter, false, Buffer.from(encodeWav({ sampleRate: 16000, channels })));
  assert.equal(result.exitCode, 0, stderr);
  const actual = parseWav(fs.readFileSync("/out.wav") as Buffer).tracks[0]!.decodedAudio!.channelData;
  const count = actual[0]!.length;
  assert.equal(count * actual.length, reference.samples);
  const pcm = Buffer.alloc(count * actual.length * 2);
  for (let i = 0; i < count; i++) for (let c = 0; c < actual.length; c++) pcm.writeInt16LE(actual[c]![i]! * 32768, (i * actual.length + c) * 2);
  assert.equal(createHash("sha256").update(pcm).digest("hex"), reference.sha256);
});

for (const [option, exitCode] of [
  ["sigma=-1", 222], ["sigma=1.1", 222], ["sigma=NaN", 234], ["levels=0", 222], ["levels=13", 222],
  ["wavet=unknown", 234], ["wavet=7", 222], ["percent=101", 222], ["profile=2", 234], ["profile=1.0", 234],
  ["adaptive=-1", 234], ["samples=511", 222], ["samples=65537", 222], ["softness=-1", 222], ["unknown=1", 8]
] as const)
  it(`rejects ${option} without replacing output`, async () => {
    const { fs, result, stderr } = await run(`afwtdn=${option}`);
    assert.equal(result.exitCode, exitCode);
    assert.ok(stderr.includes("afwtdn:"), stderr);
    assert.equal(fs.readFileSync("/out.wav", "utf8"), "KEEP");
  });

it("honors memory limits and cancellation", async () => {
  await assert.rejects(denoiseWavelets([mono], 16000, "afwtdn", [], new MediaBudgetTracker({ maxMemoryBytes: 64 })), /maxMemoryBytes/);
  await assert.rejects(denoiseWavelets([mono], 16000, "afwtdn", [], new MediaBudgetTracker(), AbortSignal.abort()));
  await assert.rejects(denoiseWavelets([mono], 16000, "afwtdn", [], new MediaBudgetTracker({ maxCpuMs: -1 })), /maxCpuMs/);
});

for (const graph of [false, true]) for (const option of [
  "threads=-1", "threads=2147483648", "threads=bogus", "threads=",
  "thread_type=bogus", "thread_type=0.5", "thread_type=4294967296",
  "extra_hw_frames=-2", "extra_hw_frames=2147483648", "extra_hw_frames=bogus"
]) it(`rejects invalid afwtdn scheduling ${option} (graph=${graph})`, async () => {
  const { fs, result, stderr } = await run(`afwtdn=${option}`, graph);
  assert.notEqual(result.exitCode, 0);
  assert.ok(stderr.includes("afwtdn:"), stderr);
  assert.equal(fs.readFileSync("/out.wav", "utf8"), "KEEP");
});
