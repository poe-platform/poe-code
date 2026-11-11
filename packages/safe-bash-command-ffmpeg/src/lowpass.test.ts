import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { passAudio } from "./audio-pass.js";
import { MediaBudgetTracker, parseWav } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

const samples = [1, 2, 3, 6, 5, 10, -1, -2, -3, -6, -5, -10, 32767, -32768, -32768, 32767];
const input = encodeWav({ sampleRate: 8000, channels: [0, 1].map(channel =>
  Float64Array.from(samples.filter((_, index) => index % 2 === channel), value => value / 32768)) });

// Native FFmpeg 7.0.2 signed PCM16, interleaved stereo at 8 kHz.
for (const [filter, expected] of [
  ["anull", samples],
  ["highpass=f=100", [0, 1, 2, 5, 4, 8, -1, -3, -3, -7, -5, -10, 30996, -30997, -32768, 32767]],
  ["lowpass", [0, 0, 0, 0, 0, 1, 1, 2, 1, 2, 0, 1, 981, -981, 2408, -2409]],
  ["lowpass=f=100", [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 47, -47, 138, -138]],
  ["lowpass=f=100:p=1", [0, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 2474, -2475, -187, 186]],
  ["lowpass=f=100,volume=1", [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 48, -48, 138, -138]],
  ["lowpass=f=100:r=f64", [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 48, -48, 138, -138]],
  ["lowpass=f=100:c=FL", [0, 2, 0, 6, 0, 10, 0, -2, 0, -6, 0, -10, 47, -32768, 138, 32767]],
  ["lowpass=f=100:m=0.5", [0, 1, 1, 3, 2, 5, 0, 0, -1, -2, -2, -4, 16407, -16407, -16314, 16314]],
  ["lowpass=f=100:b=4", [5, -5, 4, -4, 4, -4, 3, -3, 2, -2, 1, -1, 0, 0, 0, 0]],
  ["lowpass=100", [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 47, -47, 138, -138]],
  ["lowpass@cut=frequency=100:poles=1", [0, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 2474, -2475, -187, 186]]
] as const) {
  for (const graph of [false, true]) {
    for (const format of ["s16le", "wav"]) it(`matches native ${filter} (${format}, graph=${graph})`, async () => {
      const { output, result, stderr } = await run(filter, graph, format);
      assert.equal(result.exitCode, 0, stderr);
      if (format === "wav") {
        const audio = parseWav(output).tracks[0]!.decodedAudio!;
        assert.equal(audio.sampleRate, 8000);
        assert.deepEqual(audio.channelData.map(channel => Array.from(channel, value => value * 32768)),
          [0, 1].map(channel => expected.filter((_, index) => index % 2 === channel)));
      } else {
        assert.deepEqual(Array.from({ length: output.length / 2 }, (_, index) => output.readInt16LE(index * 2)), expected);
      }
    });
  }
}

for (const filter of ["lowpass=f=0", "lowpass=f=4001", "lowpass=m=0", "lowpass=w=0"]) {
  it(`bypasses ${filter}`, async () => {
    const { output, result, stderr } = await run(filter);
    assert.equal(result.exitCode, 0, stderr);
    assert.deepEqual(Array.from({ length: output.length / 2 }, (_, index) => output.readInt16LE(index * 2)), samples);
  });
}

for (const option of ["f=-1", "f=NaN", "p=3", "m=2", "unknown=1", "precision=bogus"]) {
  it(`rejects lowpass ${option} without replacing output`, async () => {
    const { fs, result, stderr, output } = await run(`lowpass=${option}`, false, "s16le", "/out.raw");
    assert.notEqual(result.exitCode, 0);
    assert.ok(stderr.includes("lowpass"), stderr);
    assert.equal(fs.readFileSync("/out.raw", "utf8"), "KEEP");
    assert.equal(output.length, 0);
  });
}

it("bounds lowpass memory and honors cancellation", async () => {
  await assert.rejects(passAudio([new Float64Array(64)], 8000, "lowpass", "s16",
    new MediaBudgetTracker({ maxMemoryBytes: 64 })), /maxMemoryBytes/);
  await assert.rejects(passAudio([new Float64Array(64)], 8000, "lowpass", "s16",
    new MediaBudgetTracker(), AbortSignal.abort()));
});

async function run(filter: string, graph = false, format = "s16le", destination = "pipe:1") {
  const fs = Volume.fromJSON({ "/in.wav": Buffer.from(input), "/out.raw": "KEEP" });
  const chunks: Buffer[] = [];
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-y", "-v", "error", "-i", "/in.wav", ...(graph
      ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]), "-f", format, destination],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return fs.readFileSync(path); },
      async writeFile(path: string, data: Uint8Array) { fs.writeFileSync(path, data); },
      async stat(path: string) { return fs.statSync(path); }
    },
    stdin: (async function* () {})(), stdout: { async write(data: Uint8Array) { chunks.push(Buffer.from(data)); } },
    stderr: { async write(data: Uint8Array) { stderr += new TextDecoder().decode(data); } }
  } as never);
  return { fs, result, stderr, output: Buffer.concat(chunks) };
}
