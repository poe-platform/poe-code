import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { MediaBudgetTracker } from "@poe-code/mp4-ast";
import { cutUltrasonicAudio } from "./audio-asupercut.js";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2 references: 96 kHz PCM with DC 500 and three 2000-unit tones.
for (const [filter, amplitude, first] of [
  ["asupercut=cutoff=20000:order=8", 10, [1, 21, 123, 400, 807, 1067, 981, 807, 934, 1290, 1520, 1545, 1552, 1664, 1853, 2006]],
  ["asupercut=cutoff=20000:order=3", 267, [54, 458, 1100, 1019, 513, 904, 1402, 1119, 1263, 1763, 1541, 1532, 2083, 1973, 1787, 2303]],
  ["asupercut=cutoff=35000:order=8", 1998, [52, 481, 1340, 1180, -95, 824, 2505, 600, 269, 3216, 1544, -46, 3471, 2509, -61, 3329]]
] as const) for (const graph of [false, true]) {
  it(`${filter} preserves audible tones, DC, and all samples (${graph ? "graph" : "simple"})`, async () => {
    const { volume, result, stderr } = await run(filter, graph);
    assert.equal(result.exitCode, 0, stderr);
    const pcm = volume.readFileSync("/out.raw") as Buffer;
    assert.equal(pcm.length, 38400 * 2);
    assert.deepEqual(Array.from({ length: 16 }, (_, i) => pcm.readInt16LE(i * 2)), first);
    const samples = Array.from({ length: 19200 }, (_, i) => pcm.readInt16LE((i + 19200) * 2));
    assert.equal(Math.round(samples.reduce((sum, value) => sum + value, 0) / samples.length), 500);
    assert.deepEqual([40, 1000, 30000].map(frequency => {
      let real = 0, imaginary = 0;
      for (const [i, sample] of samples.entries()) {
        const angle = 2 * Math.PI * frequency * i / 96000;
        real += sample * Math.cos(angle);
        imaginary += sample * Math.sin(angle);
      }
      return Math.round(2 * Math.hypot(real, imaginary) / samples.length);
    }), [2000, 2000, amplitude]);
  });
}

for (const filter of ["asupercut=cutoff=19999", "asupercut=cutoff=192001", "asupercut=order=2", "asupercut=order=21", "asupercut=level=-1", "asupercut=level=1.1", "asupercut=cutoff=NaN", "asupercut=order=", "asupercut=unknown=1"]) {
  it(`${filter} fails without replacing output`, async () => {
    const { volume, result, stderr } = await run(filter);
    assert.equal(result.exitCode, 1);
    assert.match(stderr, /asupercut/);
    assert.equal(volume.readFileSync("/out.raw", "utf8"), "KEEP");
  });
}

it("accepts positional options and expressions in a filter chain", async () => {
  const reference = await run("volume=0.5,asupercut=20000:3:0.5,areverse");
  const actual = await run("volume=0.5,asupercut=cutoff=20k:order=3.4:level=1/2,areverse", true);
  assert.equal(reference.result.exitCode, 0, reference.stderr);
  assert.equal(actual.result.exitCode, 0, actual.stderr);
  assert.deepEqual(actual.volume.readFileSync("/out.raw"), reference.volume.readFileSync("/out.raw"));
});

it("defaults to a 20 kHz cutoff, order 10, and unity level", async () => {
  const actual = await run("asupercut");
  const reference = await run("asupercut=20000:10:1");
  assert.equal(actual.result.exitCode, 0, actual.stderr);
  assert.equal(reference.result.exitCode, 0, reference.stderr);
  assert.deepEqual(actual.volume.readFileSync("/out.raw"), reference.volume.readFileSync("/out.raw"));
});

it("keeps channel states independent and applies input level once", async () => {
  const impulse = Float64Array.from({ length: 2048 }, (_, i) => i === 0 ? 0.25 : 0);
  const { volume, result, stderr } = await run("asupercut=20000:20:0.5", true, [impulse, new Float64Array(impulse.length)]);
  const reference = await run("asupercut=20000:20", false, [impulse.map(value => value * 0.5)]);
  assert.equal(result.exitCode, 0, stderr);
  assert.equal(reference.result.exitCode, 0, reference.stderr);
  const stereo = volume.readFileSync("/out.raw") as Buffer;
  const mono = reference.volume.readFileSync("/out.raw") as Buffer;
  assert.equal(stereo.length, impulse.length * 4);
  for (let i = 0; i < impulse.length; i++) {
    assert.equal(stereo.readInt16LE(i * 4), mono.readInt16LE(i * 2));
    assert.equal(stereo.readInt16LE(i * 4 + 2), 0);
  }
});

for (const sampleRate of [32000, 40000]) it(`bypasses cutoff at or above Nyquist at ${sampleRate} Hz, including level`, async () => {
  const channels = [new Float64Array([0.25, -0.5, 0.125])];
  const { volume, result, stderr } = await run("asupercut=level=0", false, channels, sampleRate);
  assert.equal(result.exitCode, 0, stderr);
  const pcm = volume.readFileSync("/out.raw") as Buffer;
  assert.deepEqual(Array.from({ length: pcm.length / 2 }, (_, i) => pcm.readInt16LE(i * 2)), [8192, -16384, 4096]);
});

it("bounds memory and honors cancellation and CPU limits", async () => {
  const channels = [new Float64Array(2048)];
  await assert.rejects(cutUltrasonicAudio(channels, 96000, "asupercut", new MediaBudgetTracker({ maxMemoryBytes: 128 })), /maxMemoryBytes/);
  await assert.rejects(cutUltrasonicAudio(channels, 96000, "asupercut", new MediaBudgetTracker(), AbortSignal.abort()));
  const budget = new MediaBudgetTracker();
  let checks = 0;
  budget.checkCpu = () => { if (++checks === 2) throw new Error("CPU limit reached"); };
  await assert.rejects(cutUltrasonicAudio(channels, 96000, "asupercut", budget), /CPU limit reached/);
});

async function run(filter: string, graph = false, channels?: Float64Array[], sampleRate = 96000) {
  const samples = Float64Array.from({ length: 38400 }, (_, i) => Math.round(500
    + [40, 1000, 30000].reduce((sum, frequency) => sum + 2000 * Math.sin(2 * Math.PI * frequency * i / 96000), 0)) / 32768);
  const volume = Volume.fromJSON({ "/out.raw": "KEEP" });
  volume.writeFileSync("/in.wav", encodeWav({ sampleRate, channels: channels ?? [samples] }));
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
