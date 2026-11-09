import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { parseWav } from "@poe-code/mp4-ast";
import { createFfmpegCommand, type FfmpegCommandsOptions } from "./index.js";

async function mix(rates: readonly number[], counts: readonly number[], stereo = false,
  filter = "amix=inputs=2", options: FfmpegCommandsOptions = {}) {
  const volume = Volume.fromJSON({ "/out.wav": "keep" });
  for (const [index, sampleRate] of rates.entries()) {
    const channel = new Float64Array(counts[index]!).fill((index ? -4000 : 8000) / 32768);
    volume.writeFileSync(`/${index}.wav`, encodeWav({ sampleRate,
      channels: stereo ? [channel, channel.map(sample => -sample)] : [channel] }));
  }
  let stderr = "";
  const result = await createFfmpegCommand(options).execute({
    args: ["-y", "-v", "error", "-i", "/0.wav", "-i", "/1.wav",
      "-filter_complex", `[0:a][1:a]${filter}[out]`, "-map", "[out]", "-c:a", "pcm_s16le", "/out.wav"],
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

// Native FFmpeg 7.0.2 mixes these 0.256 s PCM inputs at the first input's rate.
for (const rates of [[8000, 16000], [16000, 8000], [8000, 8000]]) {
  for (const stereo of [false, true]) {
    it(`mixes amix rates=${rates} stereo=${stereo} at the first input rate`, async () => {
      const { result, volume, stderr } = await mix(rates, rates.map(rate => rate * 0.256), stereo);
      assert.equal(result.exitCode, 0, stderr);
      const track = parseWav(volume.readFileSync("/out.wav") as Buffer).tracks[0]!;
      const audio = track.decodedAudio!;
      assert.equal(audio.sampleRate, rates[0]);
      assert.equal(audio.channels, stereo ? 2 : 1);
      assert.equal(track.duration / track.timescale, 0.256);
      for (const [channel, values] of audio.channelData.entries()) {
        assert.deepEqual(Array.from(values, sample => sample * 32768),
          Array<number>(rates[0]! * 0.256).fill(channel ? -2000 : 2000));
      }
    });
  }
}

for (const duration of ["first", "longest", "shortest"]) {
  for (const counts of [[2048, 2048], [1024, 4096]]) {
    it(`uses resampled lengths for duration=${duration}, counts=${counts}`, async () => {
      const { result, volume, stderr } = await mix([8000, 16000], counts, false,
        `amix=duration=${duration}:dropout_transition=0`);
      assert.equal(result.exitCode, 0, stderr);
      const audio = parseWav(volume.readFileSync("/out.wav") as Buffer).tracks[0]!.decodedAudio!;
      const lengths = [counts[0]!, counts[1]! / 2];
      const length = duration === "first" ? lengths[0]! : duration === "longest" ? Math.max(...lengths) : Math.min(...lengths);
      assert.deepEqual(Array.from(audio.channelData[0]!, sample => sample * 32768),
        Array.from({ length }, (_, i) => i < Math.min(...lengths) ? 2000 : i < lengths[0]! ? 8000 : -4000));
    });
  }
}

it("applies following filters at the negotiated rate", async () => {
  const { result, volume, stderr } = await mix([8000, 16000], [2048, 4096], false,
    "amix=inputs=2,atrim=end_sample=512,volume=0.5");
  assert.equal(result.exitCode, 0, stderr);
  const audio = parseWav(volume.readFileSync("/out.wav") as Buffer).tracks[0]!.decodedAudio!;
  assert.equal(audio.sampleRate, 8000);
  assert.deepEqual(Array.from(audio.channelData[0]!, sample => sample * 32768), Array<number>(512).fill(1000));
});

it("checks the resampling budget even when duration=first would truncate output", async () => {
  const { result, volume, stderr } = await mix([16000, 8000], [64, 128], false,
    "amix=duration=first", { limits: { maxSamplesPerTrack: 128 } });
  assert.equal(result.exitCode, 1);
  assert.ok(stderr.includes("maxSamplesPerTrack"), stderr);
  assert.equal(volume.readFileSync("/out.wav", "utf8"), "keep");
});
