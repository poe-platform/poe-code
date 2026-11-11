import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { MediaBudgetTracker } from "@poe-code/mp4-ast";
import { filterFft } from "./audio-afftfilt.js";
import references from "./fixtures/afftfilt-native.json" with { type: "json" };
import { createFfmpegCommand } from "./index.js";

const channels = [
  Float64Array.from({ length: 32 }, (_, i) => ((i * 1237) % 30001 - 15000) / 32768),
  Float64Array.from({ length: 32 }, (_, i) => (10000 - (i * 937) % 20001) / 32768)
];

async function run(filter: string, graph = false, length = 32) {
  const fs = Volume.fromJSON({});
  fs.writeFileSync("/in.wav", encodeWav({ sampleRate: 48000, channels: [
    Float64Array.from({ length }, (_, i) => ((i * 1237) % 30001 - 15000) / 32768),
    Float64Array.from({ length }, (_, i) => (10000 - (i * 937) % 20001) / 32768)
  ] }));
  const chunks: Buffer[] = [];
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-v", "error", "-i", "/in.wav", ...(graph
      ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
      "-c:a", "pcm_s16le", "-f", "s16le", "pipe:1"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return fs.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { fs.writeFileSync(path, bytes); },
      async stat(path: string) { return fs.statSync(path); }
    },
    stdin: (async function* () {})(),
    stdout: { async write(bytes: Uint8Array) { chunks.push(Buffer.from(bytes)); } },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  return { result, stderr, output: Buffer.concat(chunks) };
}

for (const reference of references) for (const graph of [false, true]) {
  it(`matches native ${reference.filter}, ${reference.length} samples, graph=${graph}`, async () => {
    const { result, stderr, output } = await run(reference.filter, graph, reference.length);
    assert.equal(result.exitCode, 0, stderr);
    const expected = Buffer.from(reference.pcm, "base64");
    assert.equal(createHash("sha256").update(expected).digest("hex"), reference.sha256);
    assert.equal(output.length, reference.length * 4);
    assert.deepEqual(output, expected);
  });
}

for (const [filter, equivalent] of [
  ["afftfilt@half=re/2:im/2:16", "afftfilt=win_size=16:real=re/2:imag=im/2"],
  ["afftfilt=win_size=16:real=re/2:imag=im/2:", "afftfilt=win_size=16:real=re/2:imag=im/2"],
  ["afftfilt=win_size=16:win_func=hann:overlap=default", "afftfilt=win_size=16"],
  ["afftfilt=win_size=16:real=re/2|re/2:imag=im/2|im/2", "afftfilt=win_size=16:real=re/2:imag=im/2"]
] as const) it(`supports ${filter}`, async () => {
  const actual = await run(filter), expected = await run(equivalent);
  assert.equal(actual.result.exitCode, 0, actual.stderr);
  assert.equal(expected.result.exitCode, 0, expected.stderr);
  assert.deepEqual(actual.output, expected.output);
});

for (const [option, exitCode] of [
  ["win_size=15", 222], ["win_size=131073", 222], ["overlap=-0.1", 222], ["overlap=1.1", 222],
  ["overlap=0.999999", 234], ["win_size=oops", 234], ["real=invalid", 234], ["imag=im+", 234], ["unknown=1", 8]
] as const) it(`rejects ${option} without emitting audio`, async () => {
  const { result, stderr, output } = await run(`afftfilt=win_size=16:${option}`);
  assert.equal(result.exitCode, exitCode, stderr);
  assert.ok(stderr.includes("afftfilt"), stderr);
  assert.equal(output.length, 0);
});

it("honors memory limits, CPU limits and cancellation", async () => {
  await assert.rejects(filterFft(channels, 48000, "afftfilt", [], new MediaBudgetTracker({ maxMemoryBytes: 64 })), /maxMemoryBytes/);
  await assert.rejects(filterFft(channels, 48000, "afftfilt", [], new MediaBudgetTracker({ maxCpuMs: -1 })), /maxCpuMs/);
  await assert.rejects(filterFft(channels, 48000, "afftfilt", [], new MediaBudgetTracker(), AbortSignal.abort()));
});

it("preserves empty input", async () => {
  const result = await filterFft([new Float32Array()], 48000, "afftfilt", [], new MediaBudgetTracker());
  assert.deepEqual(result, { channels: [new Float32Array()], frames: [] });
});

// Native FFmpeg 7.0.2, stereo 48 kHz signed 16-bit PCM; 32 samples per channel.
for (const [filter, sha256] of [
  ["afftfilt=win_size=16:real=re/2:imag=im/2", "65b75641e71a02e86a0dc9311e45326ffd03c8e145cbc31981deb83de710126a"],
  ["afftfilt=win_size=16:real=0:imag=0", "38723a2e5e8a17aa7950dc008209944e898f69a7bd10a23c839d341e935fd5ca"],
  ["anull", "790d5eb4b0a43f0c07ed8b50e5ce82d841604be5d004bcb97fc51d0ebb467358"]
] as const) for (const graph of [false, true]) {
  it(`matches native samples and duration for ${filter}, graph=${graph}`, async () => {
    const { result, stderr, output } = await run(filter, graph);
    assert.equal(result.exitCode, 0, stderr);
    assert.equal(output.length, 128);
    assert.equal(createHash("sha256").update(output).digest("hex"), sha256);
  });
}
