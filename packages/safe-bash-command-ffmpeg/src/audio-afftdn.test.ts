import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { MediaBudgetTracker, parseWav } from "@poe-code/mp4-ast";
import { denoiseFft } from "./audio-afftdn.js";
import references from "./fixtures/afftdn-native.json" with { type: "json" };
import { createFfmpegCommand } from "./index.js";

const samples = Float64Array.from({ length: 8000 }, (_, i) => (((i * 73 % 97) - 48) * 20 + (i % 40 < 20 ? 3200 : -3200)) / 32768);
const input = encodeWav({ sampleRate: 8000, channels: [samples] });

async function run(filter: string, graph = false, bytes = input) {
  const fs = Volume.fromJSON({ "/out.wav": "KEEP" });
  fs.writeFileSync("/in.wav", bytes);
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-v", "error", "-y", "-i", "/in.wav", ...(graph
      ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]), "-c:a", "pcm_s16le", "/out.wav"],
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

// Native FFmpeg 7.0.2; fixtures contain signed little-endian 16-bit PCM.
// SIMD and scalar native FFTs also differ by one PCM unit at rounding boundaries.
for (const reference of references) for (const graph of [false, true]) {
  it(`matches native ${reference.filter}, ${reference.rate} Hz, ${reference.length} samples, ${reference.channels} channels, double=${reference.double}, graph=${graph}`, async () => {
    const mono = Float64Array.from({ length: reference.length }, (_, i) => (((i * 73 % 97) - 48) * 20 + (i % 40 < 20 ? 3200 : -3200)) / 32768);
    const input = encodeWav({ sampleRate: reference.rate, channels: reference.channels === 2 ? [mono, mono.slice().reverse()] : [mono] });
    const filter = (reference.double ? "aformat=sample_fmts=dblp," : "") + reference.filter;
    const { fs, result, stderr } = await run(filter, graph, input);
    assert.equal(result.exitCode, 0, stderr);
    const audio = parseWav(fs.readFileSync("/out.wav") as Buffer).tracks[0]!.decodedAudio!;
    assert.equal(audio.sampleRate, reference.rate);
    assert.equal(audio.channels, reference.channels);
    const expected = Buffer.from(reference.pcm, "base64");
    assert.equal(createHash("sha256").update(expected).digest("hex"), reference.sha256);
    assert.equal(expected.length, reference.length * reference.channels * 2);
    for (const channel of audio.channelData) assert.equal(channel.length, reference.length);
    for (let i = 0; i < reference.length; i++) for (let c = 0; c < reference.channels; c++) {
      const actual = audio.channelData[c]![i]! * 32768;
      const native = expected.readInt16LE((i * reference.channels + c) * 2);
      assert.ok(Math.abs(actual - native) <= 1, `sample ${i}, channel ${c}: expected ${native}, got ${actual}`);
    }
    if (reference.rate === 8000 && reference.length === 8000 && !reference.double) {
      const peak = Math.max(...audio.channelData[0]!.map(value => Math.abs(value * 32768)));
      assert.equal(peak, reference.filter === "afftdn" ? 4164 : reference.filter.includes("nr=") ? 3988 : reference.filter.includes("noise") ? 1396 : 4160);
    }
  });
}

it("preserves unfiltered PCM", async () => {
  const { fs, result, stderr } = await run("anull");
  assert.equal(result.exitCode, 0, stderr);
  assert.deepEqual(parseWav(fs.readFileSync("/out.wav") as Buffer).tracks[0]!.decodedAudio!.channelData[0], Float32Array.from(samples));
});

for (const [filter, equivalent] of [
  ["afftdn=noise_reduction=18:noise_floor=-35", "afftdn=nr=18:nf=-35"],
  ["afftdn=18:-35", "afftdn=nr=18:nf=-35"],
  ["afftdn=nr=default:nf=default:", "afftdn"],
  ["afftdn=output_mode=n", "afftdn=om=noise"],
  ["afftdn=om=2", "afftdn=om=noise"],
  ["afftdn@clean=om=o", "afftdn"],
  ["afftdn=om=i", "afftdn=output_mode=input"]
]) it(`supports ${filter}`, async () => {
  const actual = await run(filter!), expected = await run(equivalent!);
  assert.equal(actual.result.exitCode, 0, actual.stderr);
  assert.equal(expected.result.exitCode, 0, expected.stderr);
  assert.deepEqual(actual.fs.readFileSync("/out.wav"), expected.fs.readFileSync("/out.wav"));
});

for (const [option, exitCode] of [
  ["nr=0", 222], ["nr=98", 222], ["nf=-81", 222], ["nf=-19", 222], ["om=3", 222],
  ["nr=NaN", 234], ["nf=", 234], ["om=bogus", 234], ["unknown=1", 8]
] as const) it(`rejects ${option} without replacing output`, async () => {
  const { fs, result, stderr } = await run(`afftdn=${option}`);
  assert.equal(result.exitCode, exitCode, stderr);
  assert.ok(stderr.includes("afftdn"), stderr);
  assert.equal(fs.readFileSync("/out.wav", "utf8"), "KEEP");
});

it("honors memory limits, CPU limits and cancellation", async () => {
  await assert.rejects(denoiseFft([samples], 8000, "afftdn", false, new MediaBudgetTracker({ maxMemoryBytes: 64 })), /maxMemoryBytes/);
  await assert.rejects(denoiseFft([samples], 8000, "afftdn", false, new MediaBudgetTracker({ maxCpuMs: -1 })), /maxCpuMs/);
  await assert.rejects(denoiseFft([samples], 8000, "afftdn", false, new MediaBudgetTracker(), AbortSignal.abort()));
});

it("keeps silence finite and preserves an empty input", async () => {
  for (const length of [0, 1, 777]) {
    const { channels } = await denoiseFft([new Float64Array(length)], 8000, "afftdn", false, new MediaBudgetTracker());
    assert.deepEqual(channels[0], new Float32Array(length));
  }
});
