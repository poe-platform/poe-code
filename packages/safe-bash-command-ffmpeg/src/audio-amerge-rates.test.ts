import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { parseWav } from "@poe-code/mp4-ast";
import { createFfmpegCommand, type FfmpegCommandsOptions } from "./index.js";

async function merge(rates: readonly number[], counts: readonly number[], reverse = false,
  following = "", options: FfmpegCommandsOptions = {}) {
  const volume = Volume.fromJSON({ "/out.wav": "keep" });
  for (const [index, count] of counts.entries()) {
    volume.writeFileSync(`/${index}.wav`, encodeWav({ sampleRate: rates[index]!,
      channels: [new Float64Array(count).fill((index ? -4000 : 8000) / 32768)] }));
  }
  let stderr = "";
  const result = await createFfmpegCommand(options).execute({
    args: ["-y", "-v", "error", "-i", "/0.wav", "-i", "/1.wav", "-filter_complex",
      `${reverse ? "[1:a][0:a]" : "[0:a][1:a]"}amerge${following}[out]`,
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

// Native FFmpeg 7.0.2: amerge uses its first connected input's sample rate
// and stops at the shorter duration after resampling, preserving channel order.
for (const [rates, counts, duration] of [
  [[8000, 16000], [2048, 4096], 0.256],
  [[8000, 16000], [1024, 4096], 0.128],
  [[8000, 16000], [2048, 2048], 0.128],
  [[8000, 8000], [2048, 2048], 0.256]
] as const) {
  for (const reverse of [false, true]) {
    for (const gain of [1, 0.5]) {
      it(`amerge negotiates rates=${rates} counts=${counts} reversed=${reverse} gain=${gain}`, async () => {
        const { result, volume, stderr } = await merge(rates, counts, reverse, gain === 1 ? "" : ",volume=0.5");
        assert.equal(result.exitCode, 0, stderr);
        const track = parseWav(volume.readFileSync("/out.wav") as Buffer).tracks[0]!;
        const audio = track.decodedAudio!;
        const rate = rates[reverse ? 1 : 0];
        assert.equal(audio.sampleRate, rate);
        assert.equal(audio.channels, 2);
        assert.equal(audio.channelMask ?? 3, 3);
        assert.equal(track.duration / track.timescale, duration);
        const expected = reverse ? [-4000, 8000] : [8000, -4000];
        for (const [channel, samples] of audio.channelData.entries()) {
          assert.deepEqual(Array.from(samples, sample => sample * 32768),
            Array<number>(duration * rate).fill(expected[channel]! * gain));
        }
      });
    }
  }
}

it("bounds amerge rate conversion before replacing output", async () => {
  const { result, volume, stderr } = await merge([16000, 8000], [64, 128], false, "",
    { limits: { maxSamplesPerTrack: 128 } });
  assert.notEqual(result.exitCode, 0);
  assert.ok(stderr.includes("maxSamplesPerTrack"), stderr);
  assert.equal(volume.readFileSync("/out.wav", "utf8"), "keep");
});
