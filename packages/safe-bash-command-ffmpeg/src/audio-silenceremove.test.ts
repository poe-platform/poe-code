import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { parseWav } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

async function run(channels: number[][], filter: string, graph = false) {
  const volume = Volume.fromJSON({ "/out.wav": "keep" });
  volume.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000,
    channels: channels.map(channel => Float64Array.from(channel, value => value / 32768)) }));
  const errors: Uint8Array[] = [];
  const result = await createFfmpegCommand().execute({
    args: ["-y", "-i", "/in.wav", ...(graph
      ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
      "-c:a", "pcm_s16le", "/out.wav"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(), stdout: { async write() {} },
    stderr: { async write(bytes: Uint8Array) { errors.push(bytes); } }
  } as never);
  return { result, volume, error: Buffer.concat(errors).toString() };
}

const source = [[0, 600], [400, 1600], [12000, 1600], [0, 800], [4000, 1600], [0, 1000]]
  .flatMap(([amplitude, count]) => Array.from({ length: count! }, (_, i) => amplitude! * (i % 2 ? -1 : 1) || 0));
for (const graph of [false, true]) {
  it(`matches every native sample across repeated silence (graph=${graph})`, async () => {
    const { result, volume, error } = await run([source],
      "silenceremove=start_periods=1:start_threshold=0.001:start_duration=0.01:stop_periods=-1:stop_threshold=0.001:stop_duration=0.03:window=0", graph);
    assert.equal(result.exitCode, 0, error);
    const actual = parseWav(volume.readFileSync("/out.wav") as Buffer).tracks[0]!.decodedAudio!.channelData[0]!;
    const expected = [...source.slice(680, 4040), ...source.slice(4600, 6440)];
    assert.equal(actual.length, 5200);
    assert.equal(Array.from(actual).filter(Boolean).length, 4720);
    assert.deepEqual(Array.from(actual, value => value * 32768), expected);
  });
}
for (const [mode, start] of [["any", 4], ["all", 8]] as const) {
  it(`matches native stereo start_mode=${mode}`, async () => {
    const channels = [[0, 8192, 8192, 0], [0, 0, -4096, -4096]].map(c => c.flatMap(v => Array(4).fill(v)));
    const { result, volume, error } = await run(channels,
      `silenceremove=start_periods=1:start_threshold=0.01:detection=peak:window=0:start_mode=${mode}`);
    assert.equal(result.exitCode, 0, error);
    const actual = parseWav(volume.readFileSync("/out.wav") as Buffer).tracks[0]!.decodedAudio!.channelData;
    assert.deepEqual(actual.map(c => Array.from(c, v => v * 32768)), channels.map(c => c.slice(start)));
  });
}
for (const filter of ["silenceremove=window=-1", "silenceremove=start_threshold=bad",
  "silenceremove=stop_periods=-9000.1", "silenceremove=start_periods=9000.1",
  "silenceremove=start_periods=-0.1", "silenceremove=stop_periods=9000.1", "silenceremove=start_mode=both", "silenceremove=detection=unknown",
  "silenceremove=unknown=1"]) {
  it(`rejects ${filter} without replacing output`, async () => {
    const { result, volume } = await run([[0, 1000, 0]], filter);
    assert.notEqual(result.exitCode, 0);
    assert.equal(volume.readFileSync("/out.wav", "utf8"), "keep");
  });
}

// Decoded PCM from native FFmpeg, using a three-sample detection window.
for (const [options, expected] of [
  ["start_periods=1:start_threshold=0.1:detection=rms", [8192, 8192, 0, 0, 0, 8192, 8192, 0, 0, 0]],
  ["start_periods=1:start_threshold=0.1:detection=avg", [8192, 0, 0, 0, 8192, 8192, 0, 0, 0]],
  ["stop_periods=1:stop_threshold=0.1:detection=rms", [0, 0, 8192, 8192, 0, 0]],
  ["stop_periods=-1:stop_threshold=0.1:detection=rms", [0, 0, 8192, 8192, 0, 0, 8192, 8192, 0, 0]],
  ["stop_periods=-1:stop_threshold=0.1:detection=avg", [0, 0, 8192, 8192, 0, 8192, 0]],
  ["stop_periods=-1:stop_threshold=0.1:detection=peak", [0, 0, 8192, 8192, 0, 8192, 8192, 0]],
  ["stop_periods=-2:stop_threshold=0.1:detection=peak", [0, 0, 8192, 8192, 0, 0, 8192, 8192, 0, 0]],
  ["start_periods=2:start_duration=0.000125:start_threshold=0.1:detection=rms", [0, 0, 8192, 8192, 0, 0, 0]],
  ["start_periods=2:start_duration=0.000125:start_threshold=0.1:detection=peak", [8192, 8192, 0, 0, 0]],
  ["start_periods=1:start_threshold=-20dB:detection=avg", [8192, 0, 0, 0, 8192, 8192, 0, 0, 0]]
] as const) {
  it(`matches native windowed ${options}`, async () => {
    const { result, volume, error } = await run([[0, 0, 8192, 8192, 0, 0, 0, 8192, 8192, 0, 0, 0]],
      `silenceremove=${options}:window=0.000375`);
    assert.equal(result.exitCode, 0, error);
    const actual = parseWav(volume.readFileSync("/out.wav") as Buffer).tracks[0]!.decodedAudio!.channelData[0]!;
    assert.deepEqual(Array.from(actual, v => v * 32768), expected);
  });
}

for (const [mode, end] of [["any", 4], ["all", 12]] as const) {
  it(`applies stop_mode=${mode} to all stereo channels`, async () => {
    const channels = [[8192, 8192, 0, 0], [-4096, 0, -4096, 0]].map(c => c.flatMap(v => Array(4).fill(v)));
    const { result, volume, error } = await run(channels,
      `silenceremove=stop_periods=1:stop_threshold=0.01:detection=peak:window=0:stop_mode=${mode}`);
    assert.equal(result.exitCode, 0, error);
    const actual = parseWav(volume.readFileSync("/out.wav") as Buffer).tracks[0]!.decodedAudio!.channelData;
    assert.deepEqual(actual.map(c => Array.from(c, v => v * 32768)), channels.map(c => c.slice(0, end)));
  });
}
for (const filter of ["anull", "silenceremove"]) {
  it(`${filter} preserves the complete source by default`, async () => {
    const { result, volume, error } = await run([source], filter);
    assert.equal(result.exitCode, 0, error);
    const actual = parseWav(volume.readFileSync("/out.wav") as Buffer).tracks[0]!.decodedAudio!.channelData[0]!;
    assert.deepEqual(Array.from(actual, v => v * 32768), source);
  });
}

const periodSource = [0, 0, 0, 0, 9000, -9000, 0, 0, 0, 0, 4000, -4000,
  0, 0, 0, 0, 0, 0, 7000, -7000, 7000, -7000, 0, 0, 0];
for (const graph of [false, true]) {
  // Native FFmpeg converts integer AVOptions with nearest, ties-to-even rounding.
  for (const [periods, start] of [[1.4, 4], [1, 4], [1.5, 5], [2.5, 5], [2, 5], [0.5, 0]] as const) {
    it(`matches native start_periods=${periods} samples (graph=${graph})`, async () => {
      const { result, volume, error } = await run([periodSource],
        `silenceremove=start_periods=${periods}:window=0:start_threshold=0.1`, graph);
      assert.equal(result.exitCode, 0, error);
      const actual = parseWav(volume.readFileSync("/out.wav") as Buffer).tracks[0]!.decodedAudio!.channelData[0]!;
      assert.deepEqual(Array.from(actual, value => value * 32768), periodSource.slice(start));
    });
  }
  for (const [fraction, integer] of [[1.4, 1], [1.5, 2], [2.5, 2], [-1.4, -1], [-1.5, -2], [-2.5, -2], [-0.5, 0]] as const) {
    it(`rounds stop_periods=${fraction} to ${integer} (graph=${graph})`, async () => {
      const filter = (periods: number) => `silenceremove=stop_periods=${periods}:window=0:stop_threshold=0.1`;
      const actual = await run([periodSource], filter(fraction), graph);
      const expected = await run([periodSource], filter(integer), graph);
      assert.equal(actual.result.exitCode, 0, actual.error);
      assert.equal(expected.result.exitCode, 0, expected.error);
      assert.deepEqual(actual.volume.readFileSync("/out.wav"), expected.volume.readFileSync("/out.wav"));
    });
  }
}
