import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { parseWav } from "@poe-code/mp4-ast";
import { createFfmpegCommand, type FfmpegCommandsOptions } from "./index.js";

async function select(rates: readonly number[], samples: number[][], selected: number, stereo = false,
  following = "", options: FfmpegCommandsOptions = {}) {
  const volume = Volume.fromJSON({ "/out.wav": "keep" });
  for (const [index, values] of samples.entries()) {
    const channel = Float64Array.from(values, sample => sample / 32768);
    volume.writeFileSync(`/${index}.wav`, encodeWav({ sampleRate: rates[index]!,
      channels: stereo ? [channel, channel.map(sample => -sample)] : [channel] }));
  }
  let stderr = "";
  const result = await createFfmpegCommand(options).execute({
    args: ["-y", "-v", "error", ...samples.flatMap((_, index) => ["-i", `/${index}.wav`]),
      "-filter_complex", samples.map((_, index) => `[${index}:a]`).join("") +
        `astreamselect=inputs=${samples.length}:map=${selected}${following}[out]`,
      "-map", "[out]", "-c:a", "pcm_s16le", "/out.wav"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(), stdout: { async write() {} },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  return { result, volume, stderr };
}

// Native FFmpeg 7.0.2 PCM16 output: framesync emits whole selected frames,
// including resampler latency, and stops when a connected input reaches EOF.
for (const [rates, counts, expected] of [
  [[8000, 16000], [2048, 4096], [2048, 2032]],
  [[16000, 8000], [4096, 2048], [4096, 4064]],
  [[8000, 16000], [1024, 4096], [1024, 1008]],
  [[8000, 16000], [2048, 2048], [1024, 1024]],
  [[8000, 16000], [128, 256], [128, 112]],
  [[8000, 16000], [64, 256], [64, 112]],
  [[8000, 16000], [128, 128], [128, 48]],
  [[8000, 16000], [128, 48], [128, 20]],
  [[8000, 16000], [32, 32], [0, 0]],
  [[16000, 8000], [128, 256], [128, 480]],
  [[16000, 8000], [32, 32], [32, 64]],
  [[16000, 8000], [8, 16], [0, 0]],
  [[44100, 48000], [4410, 4800], [4410, 4394]],
  [[48000, 44100], [4800, 4410], [4800, 4441]],
  [[8000, 11025], [2048, 2822], [2048, 2032]],
  [[11025, 8000], [2822, 2048], [2822, 2095]]
] as const) {
  for (const selected of [0, 1] as const) for (const stereo of [false, true]) {
    it(`negotiates astreamselect rates=${rates} counts=${counts} map=${selected} stereo=${stereo}`, async () => {
      const samples = counts.map((count, index) => Array<number>(count).fill(index ? -4000 : 8000));
      const { result, volume, stderr } = await select(rates, samples, selected, stereo);
      assert.equal(result.exitCode, 0, stderr);
      const track = parseWav(volume.readFileSync("/out.wav") as Buffer).tracks[0]!;
      const audio = track.decodedAudio!;
      assert.equal(audio.sampleRate, rates[0]);
      assert.equal(audio.channels, stereo ? 2 : 1);
      assert.equal(track.duration / track.timescale, expected[selected] / rates[0]);
      for (const [channel, values] of audio.channelData.entries()) {
        assert.deepEqual(Array.from(values, sample => sample * 32768),
          Array<number>(expected[selected]).fill((selected ? -4000 : 8000) * (channel ? -1 : 1)));
      }
    });
  }
}

it("applies following filters at the negotiated sample rate", async () => {
  const { result, volume, stderr } = await select([8000, 16000],
    [Array<number>(2048).fill(8000), Array<number>(4096).fill(-4000)], 1, false, ",volume=0.5");
  assert.equal(result.exitCode, 0, stderr);
  const audio = parseWav(volume.readFileSync("/out.wav") as Buffer).tracks[0]!.decodedAudio!;
  assert.equal(audio.sampleRate, 8000);
  assert.deepEqual(Array.from(audio.channelData[0]!, sample => sample * 32768), Array<number>(2032).fill(-2000));
});

it("bounds rate conversion before replacing output", async () => {
  const { result, volume, stderr } = await select([16000, 8000],
    [Array<number>(64).fill(8000), Array<number>(128).fill(-4000)], 1, false, "",
    { limits: { maxSamplesPerTrack: 128 } });
  assert.notEqual(result.exitCode, 0);
  assert.ok(stderr.includes("maxSamplesPerTrack"), stderr);
  assert.equal(volume.readFileSync("/out.wav", "utf8"), "keep");
});

for (const [rates, length, expected] of [
  [[8000, 16000], 64, [922, 1811, 2595, 1181, 2961, 945, 3117, 843, 3183, 802, 3208, 788, 3215, 784, 3216, 784]],
  [[16000, 8000], 256, [2000, 4030, 4000, -2566, -6000, 788, 8000, 6107, 2000, 3508, 4000, -2308, -6000, 630, 8000, 6213]]
] as const) {
  it(`resamples a selected waveform at ${rates[0]} Hz`, async () => {
    const ramp = Array.from({ length: 128 }, (_, index) => [2000, 4000, -6000, 8000][index % 4]!);
    const { result, volume, stderr } = await select(rates, [Array<number>(2048).fill(8000), ramp], 1);
    assert.equal(result.exitCode, 0, stderr);
    const audio = parseWav(volume.readFileSync("/out.wav") as Buffer).tracks[0]!.decodedAudio!;
    assert.equal(audio.sampleRate, rates[0]);
    assert.equal(audio.channelData[0]!.length, length);
    assert.deepEqual(Array.from(audio.channelData[0]!.subarray(0, expected.length), sample => sample * 32768), [...expected]);
  });
}

it("negotiates all connected inputs to the first input rate", async () => {
  const { result, volume, stderr } = await select([8000, 16000, 32000],
    [Array<number>(2048).fill(8000), Array<number>(4096).fill(-4000), Array<number>(8192).fill(2000)], 2);
  assert.equal(result.exitCode, 0, stderr);
  const audio = parseWav(volume.readFileSync("/out.wav") as Buffer).tracks[0]!.decodedAudio!;
  assert.equal(audio.sampleRate, 8000);
  assert.deepEqual(Array.from(audio.channelData[0]!, sample => sample * 32768), Array<number>(2032).fill(2000));
});
