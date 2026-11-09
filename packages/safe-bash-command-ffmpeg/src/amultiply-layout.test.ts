import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { parseWav } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2 PCM16 output, with equal-power rematrixing before multiplication.
for (const reverse of [false, true]) {
  for (const stereoLength of [64, 128, 256]) {
    it(`amultiply remixes to the first input layout, reverse=${reverse}, stereo frames=${stereoLength}`, async () => {
      const volume = Volume.fromJSON({ "/out.wav": "keep" });
      volume.writeFileSync("/mono.wav", encodeWav({ sampleRate: 8000,
        channels: [Float64Array.from({ length: 128 }, (_, i) => [2000, 4000, -6000, 8000][i % 4]! / 32768)] }));
      volume.writeFileSync("/stereo.wav", encodeWav({ sampleRate: 8000,
        channels: [8000, -16000].map(value => new Float64Array(stereoLength).fill(value / 32768)) }));
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-y", "-i", reverse ? "/stereo.wav" : "/mono.wav",
          "-i", reverse ? "/mono.wav" : "/stereo.wav",
          "-filter_complex", "[0:a][1:a]amultiply[out]", "-map", "[out]", "-c:a", "pcm_s16le", "/out.wav"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(), stdout: { async write() {} },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      assert.equal(result.exitCode, 0, stderr);
      const audio = parseWav(volume.readFileSync("/out.wav") as Buffer).tracks[0]!.decodedAudio!;
      assert.equal(audio.sampleRate, 8000);
      assert.equal(audio.channels, reverse ? 2 : 1);
      const expected = reverse ? [[345, 691, -1036, 1381], [-691, -1381, 2072, -2762]]
        : [[-345, -691, 1036, -1381]];
      for (const [channel, samples] of audio.channelData.entries()) {
        assert.deepEqual(Array.from(samples, sample => sample * 32768),
          Array.from({ length: Math.min(128, stereoLength) }, (_, i) => expected[channel]![i % 4]));
      }
    });
  }
}
