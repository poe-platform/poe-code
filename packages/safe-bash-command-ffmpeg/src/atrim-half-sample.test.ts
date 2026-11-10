import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { parseWav } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg rounds time bounds to the nearest sample, with ties away from zero.
for (const complex of [false, true]) {
  for (const [bound, start, end] of [
    ["start=-0.0025", 7, 24],
    ["end=-0.0025", 0, 7],
    ["start_pts=-3", 7, 24],
    ["end=-0.002501", 0, 7],
    ["start=-0.002499", 8, 24],
    ["start=0.0025", 13, 24]
  ] as const) {
    it(`atrim=${bound} rounds half samples (${complex ? "complex" : "simple"})`, async () => {
      const input = encodeWav({ sampleRate: 1000,
        channels: [Float64Array.from({ length: 24 }, (_, i) => (i + 1) / 32768)] });
      const volume = Volume.fromJSON({ "/in.wav": Buffer.from(input), "/out.wav": "KEEP" });
      const filter = `asetpts=PTS-10,atrim=${bound}`;
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-y", "-v", "error", "-i", "/in.wav",
          ...(complex ? ["-filter_complex", `[0:a]${filter}[s]`, "-map", "[s]"] : ["-af", filter]),
          "-c:a", "pcm_s16le", "/out.wav"],
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
      assert.deepEqual(Array.from(audio.channelData[0]!, value => value * 32768),
        Array.from({ length: end - start }, (_, i) => start + i + 1));
    });
  }
}
