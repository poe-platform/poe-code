import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { passAudio } from "./audio-pass.js";
import { MediaBudgetTracker, parseWav } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

const rate = 96000;
const tones = [40, 1000, 30000];
const samples = Float64Array.from({ length: 38400 }, (_, i) =>
  (500 + tones.reduce((sum, frequency) => sum + 2000 * Math.sin(2 * Math.PI * frequency * i / rate), 0)) / 32768);
const input = encodeWav({ sampleRate: rate, channels: [samples] });

// Exact PCM16 impulse responses from native FFmpeg 7.0.2, starting at frame 8.
for (const [options, response] of [
  ["f=1000:p=1", [8735, -4752, -2166, -987, -450, -205, -93, -42, -19, -8, -4, -1]],
  ["f=1000", [6828, -7218, -2253, 281, 1016, 864, 476, 160, -7, -60, -54, -31, -11, 0, 3, 3, 2]],
  ["f=1000:m=0.5", [9414, -3609, -1126, 140, 508, 432, 238, 80, -3, -30, -27, -15, -5, 0, 1, 1, 1]],
  ["f=1000:m=0", [12000]]
] as const) {
  for (const graph of [false, true]) it(`matches native PCM16 samples for ${options} (${graph ? "graph" : "simple"})`, async () => {
    const impulse = new Float64Array(64);
    impulse[8] = 12000 / 32768;
    const bytes = encodeWav({ sampleRate: 8000, channels: [impulse, impulse] });
    const { fs, result, stderr } = await run(`highpass=${options}`, graph, bytes);
    assert.equal(result.exitCode, 0, stderr);
    const audio = parseWav(fs.readFileSync("/out.wav") as Buffer).tracks[0]!.decodedAudio!;
    const expected = Array<number>(64).fill(0);
    expected.splice(8, response.length, ...response);
    assert.equal(audio.sampleRate, 8000);
    assert.deepEqual(audio.channelData.map(channel => Array.from(channel, value => value * 32768)), [expected, expected]);
  });
}

it("retains floating-point precision after an upstream format conversion", async () => {
  const impulse = new Float64Array(64);
  impulse[8] = 12000 / 32768;
  const { fs, result, stderr } = await run("volume=1:precision=double,highpass=f=1000:p=1", false,
    encodeWav({ sampleRate: 8000, channels: [impulse, impulse] }));
  assert.equal(result.exitCode, 0, stderr);
  const audio = parseWav(fs.readFileSync("/out.wav") as Buffer).tracks[0]!.decodedAudio!;
  for (const channel of audio.channelData) {
    assert.deepEqual(Array.from(channel.slice(8, 11), value => value * 32768), [8736, -4753, -2167]);
  }
});

// Native FFmpeg 7.0.2 reference amplitudes measured over the final 19200 samples.
for (const [options, mean, amplitudes] of [
  ["f=200:p=2", 0, [80, 1998, 2000]],
  ["f=200:p=1", 0, [392, 1961, 2000]],
  ["f=200:p=2:m=0", 500, [2000, 2000, 2000]],
  ["frequency=200:poles=2:mix=0.5", 250, [962, 1978, 2000]]
] as const) {
  for (const graph of [false, true]) it(`applies highpass ${options} (${graph ? "graph" : "simple"})`, async () => {
    const { fs, result, stderr } = await run(`highpass=${options}`, graph);
    assert.equal(result.exitCode, 0, stderr);
    const audio = parseWav(fs.readFileSync("/out.wav") as Buffer).tracks[0]!.decodedAudio!;
    assert.equal(audio.sampleRate, rate);
    assert.equal(audio.channelData[0]!.length, samples.length);
    const tail = Array.from(audio.channelData[0]!.slice(19200), value => value * 32768);
    assert.ok(Math.abs(tail.reduce((sum, value) => sum + value, 0) / tail.length - mean) < 1);
    for (const [index, frequency] of tones.entries()) {
      let real = 0, imaginary = 0;
      for (const [i, value] of tail.entries()) {
        real += value * Math.cos(2 * Math.PI * frequency * i / rate);
        imaginary += value * Math.sin(2 * Math.PI * frequency * i / rate);
      }
      const amplitude = 2 * Math.hypot(real, imaginary) / tail.length;
      assert.ok(Math.abs(amplitude - amplitudes[index]!) < 2, `${frequency}: ${amplitude}`);
    }
    if (options.endsWith("m=0")) assert.deepEqual(audio.channelData, parseWav(input).tracks[0]!.decodedAudio!.channelData);
  });
}

it("keeps channel histories separate", async () => {
  const { fs, result, stderr } = await run("highpass=f=200", false,
    encodeWav({ sampleRate: rate, channels: [samples, new Float64Array(samples.length)] }));
  assert.equal(result.exitCode, 0, stderr);
  const audio = parseWav(fs.readFileSync("/out.wav") as Buffer).tracks[0]!.decodedAudio!;
  assert.ok(audio.channelData[1]!.every(value => value === 0));
});

for (const options of ["f=NaN", "f=-1", "f=1000000", "f=", "p=0", "p=3", "p=2.1", "m=-1", "m=1.1", "unknown=1"]) {
  it(`rejects invalid highpass ${options} without overwriting`, async () => {
    const { fs, result, stderr } = await run(`highpass=${options}`);
    assert.notEqual(result.exitCode, 0);
    assert.match(stderr, /highpass/);
    assert.equal(fs.readFileSync("/out.wav", "utf8"), "KEEP");
  });
}

for (const options of ["c=", "channels=bogus"]) {
  it(`leaves audio unchanged for highpass ${options}`, async () => {
    const { fs, result, stderr } = await run(`highpass=${options}`);
    assert.equal(result.exitCode, 0, stderr);
    assert.deepEqual(
      parseWav(fs.readFileSync("/out.wav") as Buffer).tracks[0]!.decodedAudio!.channelData,
      parseWav(input).tracks[0]!.decodedAudio!.channelData
    );
  });
}

async function run(filter: string, graph = false, bytes: Uint8Array = input) {
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

for (const filter of ["highpass=f=0", "highpass=f=48001", "highpass=f=999999"]) {
  it(`bypasses out-of-band cutoff: ${filter}`, async () => {
    const { fs, result, stderr } = await run(filter);
    assert.equal(result.exitCode, 0, stderr);
    assert.deepEqual(parseWav(fs.readFileSync("/out.wav") as Buffer).tracks[0]!.decodedAudio!.channelData,
      parseWav(input).tracks[0]!.decodedAudio!.channelData);
  });
}

it("uses the native default cutoff and accepts positional frequency", async () => {
  const results = await Promise.all(["highpass", "highpass=3000", "highpass=f=3000:p=2:m=1"].map(filter => run(filter)));
  for (const { result, stderr } of results) assert.equal(result.exitCode, 0, stderr);
  assert.deepEqual(results[0]!.fs.readFileSync("/out.wav"), results[1]!.fs.readFileSync("/out.wav"));
  assert.deepEqual(results[0]!.fs.readFileSync("/out.wav"), results[2]!.fs.readFileSync("/out.wav"));
});

it("bounds memory and honors cancellation", async () => {
  await assert.rejects(passAudio([samples], rate, "highpass", "s16", new MediaBudgetTracker({ maxMemoryBytes: 64 })), /maxMemoryBytes/);
  await assert.rejects(passAudio([samples], rate, "highpass", "s16", new MediaBudgetTracker(), AbortSignal.abort()));
});

for (const graph of [false, true]) {
  for (const [selection, selected] of [
    ["c=FL", [0]], ["channels=FL", [0]], ["channels=FR", [1]], ["c=FL+FR", [0, 1]],
    ["c=all", [0, 1]], ["", [0, 1]], ["c=FC", []], ["c=FL:m=0", []]
  ] as const) {
    it(`filters only selected impulse channels: ${selection} (graph=${graph})`, async () => {
      const impulse = Float64Array.from({ length: 64 }, (_, i) => i === 8 ? 12000 / 32768 : 0);
      const bytes = encodeWav({ sampleRate: 8000, channels: [impulse, impulse] });
      const { fs, result, stderr } = await run(`highpass=f=1000${selection ? ":" + selection : ""}`, graph, bytes);
      assert.equal(result.exitCode, 0, stderr);
      const audio = parseWav(fs.readFileSync("/out.wav") as Buffer).tracks[0]!.decodedAudio!;
      const source = parseWav(bytes).tracks[0]!.decodedAudio!;
      for (const [index, channel] of audio.channelData.entries()) {
        if (!(selected as readonly number[]).includes(index)) {
          assert.deepEqual(channel, source.channelData[index]);
        } else {
          // Native FFmpeg 7.0.2 PCM16 impulse response.
          const actual = Array.from(channel.slice(8, 11), sample => sample * 32768);
          for (const [i, expected] of [6828, -7218, -2253].entries()) {
            assert.ok(Math.abs(actual[i]! - expected) <= 1, `${actual[i]} != ${expected}`);
          }
        }
      }
    });
  }
}

for (const graph of [false, true]) {
  it(`selects speakers from the upstream channel layout (graph=${graph})`, async () => {
    const impulse = Float64Array.from({ length: 64 }, (_, i) => i === 8 ? 12000 / 32768 : 0);
    const bytes = encodeWav({ sampleRate: 8000, channels: [impulse, impulse] });
    const { fs, result, stderr } = await run("pan=3.0|c0=c0|c1=c0|c2=c1,highpass=f=1000:c=FC", graph, bytes);
    assert.equal(result.exitCode, 0, stderr);
    const audio = parseWav(fs.readFileSync("/out.wav") as Buffer).tracks[0]!.decodedAudio!;
    assert.deepEqual(audio.channelData[0], parseWav(bytes).tracks[0]!.decodedAudio!.channelData[0]);
    assert.deepEqual(audio.channelData[1], audio.channelData[0]);
    assert.ok(Math.abs(audio.channelData[2]![8]! * 32768 - 6828) <= 1);
  });
}
