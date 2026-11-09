import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { MediaBudgetTracker } from "@poe-code/mp4-ast";
import { cutSubAudio } from "./audio-asubcut.js";
import { createFfmpegCommand } from "./index.js";

const mono = Float64Array.from({ length: 38400 }, (_, i) => Math.round(500 +
  [40, 1000, 30000].reduce((sum, frequency) => sum + 2000 * Math.sin(2 * Math.PI * frequency * i / 96000), 0)) / 32768);

// Native FFmpeg 7.0.2 reference measurements, also verified with 9.0.1.
for (const [filter, amplitudes, first] of [
  ["anull", [2000, 2000, 2000], [500, 2484, -643, 141]],
  ["asubcut=cutoff=100:order=8", [1, 2000, 2000], [492, 2426, -730, 63]],
  ["asubcut=cutoff=100:order=3", [128, 2000, 2000], [497, 2461, -678, 110]],
  ["asubcut=cutoff=20:order=8", [2029, 2000, 2000], [498, 2472, -661, 125]]
] as const) for (const graph of [false, true]) it(`${filter} matches native rumble filtering (graph=${graph})`, async () => {
  const { volume, result, stderr } = await run(filter, graph);
  assert.equal(result.exitCode, 0, stderr);
  const bytes = volume.readFileSync("/out.raw") as Buffer;
  assert.equal(bytes.length, mono.length * 2);
  const samples = Array.from({ length: mono.length }, (_, i) => bytes.readInt16LE(i * 2));
  assert.deepEqual(samples.slice(0, 4), first);
  const tail = samples.slice(19200);
  for (const [index, frequency] of [40, 1000, 30000].entries()) {
    let real = 0;
    let imaginary = 0;
    tail.forEach((sample, i) => {
      real += sample * Math.cos(2 * Math.PI * frequency * i / 96000);
      imaginary += sample * Math.sin(2 * Math.PI * frequency * i / 96000);
    });
    const amplitude = 2 * Math.hypot(real, imaginary) / tail.length;
    assert.ok(Math.abs(amplitude - amplitudes[index]!) < 3, `${frequency} Hz: ${amplitude}`);
  }
  const mean = tail.reduce((sum, sample) => sum + sample, 0) / tail.length;
  assert.ok(Math.abs(mean - (filter === "anull" ? 500 : 0)) < 2, `DC: ${mean}`);
});

for (const option of ["cutoff=1", "cutoff=201", "order=2", "order=21", "level=-1", "level=2", "cutoff=NaN", "cutoff=", "unknown=1"]) {
  it(`rejects ${option} without replacing output`, async () => {
    const { volume, result, stderr } = await run(`asubcut=${option}`);
    assert.equal(result.exitCode, 1);
    assert.match(stderr, /asubcut/);
    assert.equal(volume.readFileSync("/out.raw", "utf8"), "KEEP");
  });
}

it("supports defaults, positional options, level, and independent stereo channels", async () => {
  for (const [filter, first] of [
    ["asubcut", [498, 2469, -665, 121]],
    ["asubcut=100:5:0.5", [247, 1224, -349, 46]],
    ["asubcut=level=0", [0, 0, 0, 0]]
  ] as const) {
    const { volume, result, stderr } = await run(filter, false, [mono, new Float64Array(mono.length)]);
    assert.equal(result.exitCode, 0, stderr);
    const bytes = volume.readFileSync("/out.raw") as Buffer;
    assert.equal(bytes.length, mono.length * 4);
    assert.deepEqual(first.map((_, i) => bytes.readInt16LE(i * 4)), first);
    for (let i = 0; i < mono.length; i++) assert.equal(bytes.readInt16LE(i * 4 + 2), 0);
  }
});

async function run(filter: string, graph = false, channels = [mono]) {
  const volume = Volume.fromJSON({ "/out.raw": "KEEP" });
  volume.writeFileSync("/in.wav", encodeWav({ sampleRate: 96000, channels }));
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-y", "-v", "error", "-i", "/in.wav", ...(graph
      ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]), "-f", "s16le", "/out.raw"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(), stdout: { async write() {} },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  return { volume, result, stderr };
}

it("bounds memory and honors cancellation", async () => {
  await assert.rejects(cutSubAudio([mono], 96000, "asubcut", "pcm_s16le", new MediaBudgetTracker({ maxMemoryBytes: 64 })), /maxMemoryBytes/);
  await assert.rejects(cutSubAudio([mono], 96000, "asubcut", "pcm_s16le", new MediaBudgetTracker(), AbortSignal.abort()));
});

it("bypasses at Nyquist without applying level, as native does", async () => {
  const output = await cutSubAudio([mono], 400, "asubcut=cutoff=200:level=0", "pcm_s16le", new MediaBudgetTracker());
  assert.deepEqual(output[0], mono);
});
