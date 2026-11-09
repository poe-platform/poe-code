import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { parseWav } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

const left = [24000, 0, 16384, 12000];
const right = [-4000, -3000, -2000, -1000];
for (const [channel, expected] of [
  [-2, [0, 0, 0, 0]],
  [-1.9, [0, 0, 0, 0]],
  [-1, [0, 0, 0, 0]],
  [-0.9, left],
  [0, left],
  [1, right],
  [2, right]
] as const) {
  for (const codec of ["pcm_s16le", "pcm_f32le"]) {
    for (const complex of [false, true]) {
      it(`selects aeval channel ${channel} (${codec}, ${complex ? "graph" : "simple"})`, async () => {
        const volume = Volume.fromJSON({});
        volume.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000,
          channels: [left, right].map(samples => Float64Array.from(samples, sample => sample / 32768)) }));
        const filter = `aeval=val(${channel})`;
        const filters = complex
          ? ["-filter_complex", `[0:a]${filter}[s]`, "-map", "[s]"]
          : ["-af", filter];
        let stderr = "";
        const result = await createFfmpegCommand().execute({
          args: ["-y", "-v", "error", "-i", "/in.wav", ...filters, "-c:a", codec, "/out.wav"],
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
        assert.equal(audio.channels, 1);
        assert.equal(audio.sampleRate, 8000);
        assert.deepEqual(Array.from(audio.channelData[0]!, sample => sample * 32768), expected);
      });
    }
  }
}
