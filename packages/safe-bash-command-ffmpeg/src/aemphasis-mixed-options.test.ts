import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Complete stereo PCM16 output from native FFmpeg 7.0.2 at 48 kHz.
for (const [options, expected] of [
  [["level_out=2:1", "level_out=1", "level_in=2:0.5", "level_in=2:level_out=0.5",
    "level_out=2:level_in=3:0.5", "level_in=0.5:level_out=2"],
  [330, 0, 343, -165, 67, -171, 140, -34, 43, -70, 44, -21, 34, -22, 6, -17,
    683, 96, 680, 91, 149, 23, 274, 34, 93, 15, 86, 9, 70, 11, 11, 0]],
  [["2:level_out=3:0.5", "level_in=0.5:level_out=3"],
  [494, 0, 514, -247, 101, -257, 209, -50, 64, -105, 66, -32, 50, -33, 9, -25,
    1025, 144, 1020, 136, 224, 34, 411, 51, 140, 23, 128, 14, 105, 17, 17, 0]],
  [["level_out=2:1:reproduction:riaa", "type=riaa"],
  [94, 0, 222, -47, 198, -111, 151, -99, 138, -75, 111, -69, 102, -56, 89, -51,
    270, -16, 519, 26, 466, 22, 368, 10, 339, 8, 284, 2, 263, 0, 235, -3]]
] as const) {
  for (const argument of options) {
    for (const graph of [false, true]) {
      it(`matches native aemphasis=${argument} (${graph ? "graph" : "simple"})`, async () => {
        const input = Buffer.alloc(64);
        input.writeInt16LE(1001, 0);
        input.writeInt16LE(-501, 6);
        input.writeInt16LE(2001, 32);
        input.writeInt16LE(301, 34);
        const volume = Volume.fromJSON({ "/in.raw": input });
        const chunks: Buffer[] = [];
        let stderr = "";
        const filter = `aemphasis=${argument}`;
        const result = await createFfmpegCommand().execute({
          args: ["-hide_banner", "-nostats", "-v", "error", "-f", "s16le", "-ar", "48000", "-ac", "2", "-i", "/in.raw",
            ...(graph ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
            "-f", "s16le", "pipe:1"],
          cwd: "/", env: {}, signal: new AbortController().signal,
          fs: {
            async readFile(path: string) { return volume.readFileSync(path); },
            async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
            async stat(path: string) { return volume.statSync(path); }
          },
          stdin: (async function* () {})(),
          stdout: { async write(bytes: Uint8Array) { chunks.push(Buffer.from(bytes)); } },
          stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
        } as never);
        assert.equal(result.exitCode, 0, stderr);
        const pcm = Buffer.concat(chunks);
        assert.deepEqual(Array.from({ length: pcm.length / 2 }, (_, i) => pcm.readInt16LE(i * 2)), expected);
      });
    }
  }
}
