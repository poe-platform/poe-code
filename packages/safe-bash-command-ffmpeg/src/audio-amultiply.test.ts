import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { parseWav } from "@poe-code/mp4-ast";
import { createFfmpegCommand, type FfmpegCommandsOptions } from "./index.js";

async function multiply(filter: string, a: number[], b: number[], stereo = false, rates = [8000, 8000], options: FfmpegCommandsOptions = {}) {
  const volume = Volume.fromJSON({ "/out.wav": "keep" });
  for (const [path, samples, sampleRate] of [["/a.wav", a, rates[0]!], ["/b.wav", b, rates[1]!]] as const) {
    const channel = Float64Array.from(samples, sample => sample / 32768);
    volume.writeFileSync(path, encodeWav({ sampleRate,
      channels: stereo ? [channel, channel.map(sample => -sample)] : [channel] }));
  }
  const errors: Uint8Array[] = [];
  const result = await createFfmpegCommand(options).execute({
    args: ["-y", "-i", "/a.wav", "-i", "/b.wav", ...(
      filter.startsWith("map:") ? ["-map", filter.slice(4)] :
        ["-filter_complex", `[0:a][1:a]${filter}[mix]`, "-map", "[mix]"]),
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

const a = Array.from({ length: 8192 }, (_, i) => i % 8 < 4 ? 8192 : -8192);
const b = Array.from({ length: 4096 }, (_, i) => i < 2048 ? -16384 : 1024);
for (const filter of ["amultiply", "amultiply@mul"]) {
  for (const stereo of [false, true]) {
    for (const reverse of [false, true]) {
      it(`${filter} matches native PCM and shortest duration, stereo=${stereo}, reverse=${reverse}`, async () => {
        const { result, volume, error } = await multiply(filter, reverse ? b : a, reverse ? a : b, stereo);
        assert.equal(result.exitCode, 0, error);
        const audio = parseWav(volume.readFileSync("/out.wav") as Buffer).tracks[0]!.decodedAudio!;
        assert.equal(audio.sampleRate, 8000);
        assert.equal(audio.channels, stereo ? 2 : 1);
        for (const channel of audio.channelData) {
          assert.deepEqual(Array.from(channel, sample => sample * 32768), b.map((v, i) => v * a[i]! / 32768));
        }
      });
    }
  }

  it(`${filter} applies following filters`, async () => {
    const { result, volume, error } = await multiply(`${filter},volume=0.5`, a, b);
    assert.equal(result.exitCode, 0, error);
    const audio = parseWav(volume.readFileSync("/out.wav") as Buffer).tracks[0]!.decodedAudio!;
    assert.deepEqual(Array.from(audio.channelData[0]!, sample => sample * 32768), b.map((v, i) => v * a[i]! / 65536));
  });

  it(`${filter} rejects options without replacing output`, async () => {
    const { result, volume } = await multiply(`${filter}=unknown=1`, a, b);
    assert.notEqual(result.exitCode, 0);
    assert.equal(volume.readFileSync("/out.wav", "utf8"), "keep");
  });
}

// Native FFmpeg PCM16 output for an 8 kHz repeating ramp and a 16 kHz half-scale signal.
const ramp = Array.from({ length: 128 }, (_, i) => [2000, 4000, -6000, 8000][i % 4]!);
const gain = Array<number>(256).fill(16384);
for (const stereo of [false, true]) {
  for (const reverse of [false, true]) {
    it(`amultiply resamples to the first input rate, stereo=${stereo}, reverse=${reverse}`, async () => {
      const { result, volume, error } = await multiply("amultiply", reverse ? gain : ramp,
        reverse ? ramp : gain, stereo, reverse ? [16000, 8000] : [8000, 16000]);
      assert.equal(result.exitCode, 0, error);
      const audio = parseWav(volume.readFileSync("/out.wav") as Buffer).tracks[0]!.decodedAudio!;
      assert.equal(audio.sampleRate, reverse ? 16000 : 8000);
      assert.equal(audio.channels, stereo ? 2 : 1);
      for (const channel of audio.channelData) {
        assert.equal(channel.length, reverse ? 256 : 128);
        const pcm = Array.from(channel, sample => sample * 32768);
        if (reverse) assert.deepEqual(pcm.slice(0, 8), [1000, 2015, 2000, -1283, -3000, 394, 4000, 3053]);
        else assert.deepEqual(pcm, ramp.map(sample => sample / 2));
      }
    });
  }
}

for (const [firstLength, secondLength, expected] of [[128, 128, 64], [64, 256, 64], [128, 48, 20], [128, 32, 0]] as const) {
  it(`amultiply ends at the shorter resampled input (${firstLength}, ${secondLength})`, async () => {
    const { result, volume, error } = await multiply("amultiply,volume=0.5",
      Array<number>(firstLength).fill(8000), Array<number>(secondLength).fill(16384), false, [8000, 16000]);
    assert.equal(result.exitCode, 0, error);
    const audio = parseWav(volume.readFileSync("/out.wav") as Buffer).tracks[0]!.decodedAudio!;
    assert.equal(audio.sampleRate, 8000);
    assert.deepEqual(Array.from(audio.channelData[0]!, sample => sample * 32768), Array<number>(expected).fill(2000));
  });
}

it("amultiply bounds the resampled input before replacing output", async () => {
  const { result, volume, error } = await multiply("amultiply", gain.slice(0, 64), ramp,
    false, [16000, 8000], { limits: { maxSamplesPerTrack: 128 } });
  assert.notEqual(result.exitCode, 0);
  assert.ok(error.includes("maxSamplesPerTrack"), error);
  assert.equal(volume.readFileSync("/out.wav", "utf8"), "keep");
});
