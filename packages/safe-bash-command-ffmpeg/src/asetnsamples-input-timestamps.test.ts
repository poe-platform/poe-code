import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

// FFmpeg 7.0.2 keeps the input PTS when regrouping PCM; sample bounds count from zero.
for (const [flags, firstFrame, secondFrame, sampleBound] of [
  [["-itsoffset", "0.003"], [1], [1, 2, 3, 4, 5], [1, 2, 3, 4]],
  [["-ss", "0.003", "-copyts"], [4], [4, 5, 6, 7, 8], [4, 5, 6, 7]],
  [[], [1, 2, 3, 4], [1, 2, 3, 4, 5, 6, 7, 8], [1, 2, 3, 4]]
] as const) {
  for (const graph of [false, true]) {
    for (const [filter, expected] of [
      ["atrim=end_pts=4", firstFrame],
      ["asetnsamples=n=4:p=0,atrim=end_pts=4", firstFrame],
      ["asetnsamples=n=4:p=0,atrim=end_pts=8", secondFrame],
      ["asetnsamples=n=4:p=0,atrim=start_pts=68:end_pts=72",
        flags[0] === "-itsoffset" ? [66, 67, 68, 69] : [69, 70, 71, 72]],
      ["asetnsamples=n=4:p=0,atrim=end_sample=4", sampleBound]
    ] as const) {
      it(`preserves input timestamps: ${flags.join(" ")} ${filter}, graph=${graph}`, async () => {
        const input = encodeWav({ sampleRate: 1000,
          channels: [Float64Array.from({ length: 80 }, (_, i) => (i + 1) / 32768)] });
        const volume = Volume.fromJSON({ "/in.wav": Buffer.from(input) });
        const stdout: Buffer[] = [];
        let stderr = "";
        const result = await createFfmpegCommand().execute({
          args: ["-v", "error", ...flags, "-i", "/in.wav",
            ...(graph ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
            "-f", "s16le", "pipe:1"],
          cwd: "/", env: {}, signal: new AbortController().signal,
          fs: {
            async readFile(path: string) { return volume.readFileSync(path); },
            async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
            async stat(path: string) { return volume.statSync(path); }
          },
          stdin: (async function* () {})(),
          stdout: { async write(bytes: Uint8Array) { stdout.push(Buffer.from(bytes)); } },
          stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
        } as never);
        assert.equal(result.exitCode, 0, stderr);
        assert.equal(stderr, "");
        const output = Buffer.concat(stdout);
        assert.deepEqual(Array.from({ length: output.length / 2 }, (_, i) => output.readInt16LE(i * 2)), expected);
      });
    }
  }
}
