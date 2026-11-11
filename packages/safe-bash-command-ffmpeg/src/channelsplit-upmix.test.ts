import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg preserves stereo fronts and fills the other speakers with silence.
for (const [layout, speaker, expected] of [
  ["2.1", "FL", "64009cff"],
  ["2.1", "FR", "c80038ff"],
  ["2.1", "LFE", "00000000"],
  ["quad", "FL", "64009cff"],
  ["quad", "FR", "c80038ff"],
  ["quad", "BL", "00000000"],
  ["quad", "BR", "00000000"],
  ["5.1(side)", "FL", "64009cff"],
  ["5.1(side)", "FR", "c80038ff"],
  ["5.1(side)", "FC", "00000000"],
  ["5.1(side)", "LFE", "00000000"],
  ["5.1(side)", "SL", "00000000"],
  ["5.1(side)", "SR", "00000000"],
  ["0xb", "LFE", "00000000"],
  ["FL+FR+BL+BR", "FR", "c80038ff"],
  ["0x60f", "SR", "00000000"],
  ["5.1", "FL", "64009cff"],
  ["5.1", "FR", "c80038ff"],
  ["5.1", "FC", "00000000"],
  ["5.1", "LFE", "00000000"],
  ["5.1", "BL", "00000000"],
  ["5.1", "BR", "00000000"],
  ["stereo", "FL", "64009cff"]
] as const) {
  for (const wav of [false, true]) {
    for (const graph of [false, true]) {
      it(`splits stereo into ${layout}:${speaker} (${graph ? "graph" : "simple"}, ${wav ? "wav" : "raw"})`, async () => {
        const volume = Volume.fromJSON({ "/in.raw": Buffer.from("6400c8009cff38ff", "hex") });
        if (wav) volume.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000,
          channels: [[100, -100], [200, -200]].map(samples => Float64Array.from(samples, value => value / 32768)) }));
        const filter = `channelsplit=${layout}:${speaker}`;
        let stderr = "";
        const result = await createFfmpegCommand().execute({
          args: ["-v", "error", ...(wav ? ["-i", "/in.wav"]
            : ["-f", "s16le", "-ar", "8000", "-ac", "2", "-channel_layout", "stereo", "-i", "/in.raw"]),
            ...(graph ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
            "-c:a", "pcm_s16le", "-f", "s16le", "/out.raw"],
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
        assert.equal((volume.readFileSync("/out.raw") as Buffer).toString("hex"), expected);
      });
    }
  }
}
