import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg preserves stereo fronts and fills the other 5.1 speakers with silence.
for (const [layout, speaker, expected] of [
  ["5.1", "FL", "64009cff"],
  ["5.1", "FR", "c80038ff"],
  ["5.1", "FC", "00000000"],
  ["5.1", "LFE", "00000000"],
  ["5.1", "BL", "00000000"],
  ["5.1", "BR", "00000000"],
  ["stereo", "FL", "64009cff"]
] as const) {
  for (const graph of [false, true]) {
    it(`splits stereo into ${layout}:${speaker} (${graph ? "graph" : "simple"})`, async () => {
      const volume = Volume.fromJSON({ "/in.raw": Buffer.from("6400c8009cff38ff", "hex") });
      const filter = `channelsplit=${layout}:${speaker}`;
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-f", "s16le", "-ar", "8000", "-ac", "2", "-channel_layout", "stereo", "-i", "/in.raw",
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
