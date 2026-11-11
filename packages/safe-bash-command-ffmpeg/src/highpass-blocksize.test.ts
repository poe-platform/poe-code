import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { MediaBudgetTracker, parseWav } from "@poe-code/mp4-ast";
import { highpassAudio } from "./audio-highpass.js";
import { createFfmpegCommand } from "./index.js";

// Decoded PCM16 reference samples from native FFmpeg 7.0.2, at 8 kHz.
for (const [length, impulse, options, expected] of [
  [64, 8, "b=8", [40, 102, 166, 164, -34, -592, -1571, -2667, 8826, -2666, -1570, -592, -34, 164, 167, 101]],
  [64, 8, "blocksize=8", [40, 102, 166, 164, -34, -592, -1571, -2667, 8826, -2666, -1570, -592, -34, 164, 167, 101]],
  [64, 8, "blocksize=0", [0, 0, 0, 0, 0, 0, 0, 0, 6828, -7218, -2253, 281]],
  [64, 8, "b=0", [0, 0, 0, 0, 0, 0, 0, 0, 6828, -7218, -2253, 281]],
  [64, 8, "b=8.5", [40, 102, 166, 164, -34, -592, -1571, -2667, 8826, -2666, -1570, -592]],
  [64, 8, "b=8:m=0", [0, 0, 0, 0, 0, 0, 0, 0, 12000, 0, 0, 0]],
  [64, 8, "b=8:p=1", [-9, -21, -46, -102, -225, -494, -1083, -2376, 8734, -2376, -1083, -493]],
  [64, 8, "b=8:m=0.5", [8, 65, 160, 257, 245, -77, -956, -2471, 8620, -2471, -955, -78]],
  [19, 17, "b=8", [0, 0, 0, 0, 0, 0, 0, 0, 4, 40, 102, 166, 164, -34, -591, -1570, -2667, 8824, -2673]],
  [5, 0, "b=8", [8826, -2666, -1569, -588, -27]],
  [5, 0, "b=1", [8227, -2751, -1451, -451, 578]]
] as const) {
  for (const graph of [false, true]) it(`matches reverse highpass ${options}, ${length} frames (graph=${graph})`, async () => {
    const impulseSamples = Float64Array.from({ length }, (_, i) => i === impulse ? 12000 / 32768 : 0);
    const { fs, result, stderr } = await run(`highpass=f=1000:${options}`, graph,
      encodeWav({ sampleRate: 8000, channels: [impulseSamples, impulseSamples, new Float64Array(length)] }));
    assert.equal(result.exitCode, 0, stderr);
    const audio = parseWav(fs.readFileSync("/out.wav") as Buffer).tracks[0]!.decodedAudio!;
    assert.equal(audio.sampleRate, 8000);
    assert.equal(audio.channelData[0]!.length, length);
    for (const [i, value] of expected.entries()) {
      const actual = audio.channelData[0]![i]! * 32768;
      assert.ok(Math.abs(actual - value) <= 2, `sample ${i}: ${actual}, expected ${value}`);
    }
    assert.deepEqual(audio.channelData[1], audio.channelData[0]);
    assert.ok(audio.channelData[2]!.every(value => value === 0));
  });
}

it("accounts for reverse-filter scratch memory and cancellation", async () => {
  await assert.rejects(highpassAudio([new Float64Array(1)], 8000, "highpass=f=1000:b=32768",
    new MediaBudgetTracker({ maxMemoryBytes: 1024 })), /maxMemoryBytes/);
  await assert.rejects(highpassAudio([new Float64Array(1)], 8000, "highpass=b=8",
    new MediaBudgetTracker(), AbortSignal.abort()));
});

for (const value of ["-1", "32769", "NaN", ""]) it(`rejects invalid blocksize ${value}`, async () => {
  const { fs, result, stderr } = await run(`highpass=b=${value}`, false,
    encodeWav({ sampleRate: 8000, channels: [new Float64Array(8)] }));
  assert.equal(result.exitCode, 1);
  assert.match(stderr, /highpass/);
  assert.equal(fs.readFileSync("/out.wav", "utf8"), "KEEP");
});

async function run(filter: string, graph: boolean, bytes: Uint8Array) {
  const fs = Volume.fromJSON({ "/out.wav": "KEEP" });
  fs.writeFileSync("/in.wav", bytes);
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-y", "-v", "error", "-i", "/in.wav", ...(graph
      ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]), "-c:a", "pcm_s16le", "/out.wav"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return fs.readFileSync(path); },
      async writeFile(path: string, data: Uint8Array) { fs.writeFileSync(path, data); },
      async stat(path: string) { return fs.statSync(path); }
    },
    stdin: (async function* () {})(), stdout: { async write() {} },
    stderr: { async write(data: Uint8Array) { stderr += new TextDecoder().decode(data); } }
  } as never);
  return { fs, result, stderr };
}
