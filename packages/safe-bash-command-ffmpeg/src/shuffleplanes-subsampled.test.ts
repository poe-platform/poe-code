import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Complete raw frames from native FFmpeg 7.0.2, with a 4x2 input.
for (const graph of [false, true]) {
  for (const [format, input, filter, outputFormat, expected] of [
    ["yuv420p", "111c27323d48535e69747f8a", "shuffleplanes=0:0:0:0", "yuv420p", "111c27323d48535e43594359"],
    ["yuv422p", "111c27323d48535e69747f8a95a0abb6", "shuffleplanes=0:0:0:0", "yuv422p", "111c27323d48535e172d4359172d4359"],
    ["nv12", "111c27323d48535e69747f8a", "shuffleplanes=0:0:0:0", "nv12", "111c27323d48535e43435959"],
    ["yuv444p", "111c27323d48535e69747f8a95a0abb6c1ccd7e2edf8030e", "shuffleplanes=0:0:0:0", "yuv444p", "111c27323d48535e111c27323d48535e111c27323d48535e"],
    ["yuv420p", "111c27323d48535e69747f8a", "shuffleplanes=0:2:1:3", "yuv420p", "111c27323d48535e7f8a6974"],
    ["yuv420p", "111c27323d48535e69747f8a", "shuffleplanes=0:0:0:0", "yuv444p", "111c27323d48535e111c27323d48535e111c27323d48535e"]
  ] as const) {
    it(`${graph ? "graph" : "simple"} negotiates ${format} ${filter} to ${outputFormat}`, async () => {
      const volume = Volume.fromJSON({ "/in.raw": Buffer.from(input, "hex") });
      const stdout: Uint8Array[] = [];
      const stderr: Uint8Array[] = [];
      const result = await createFfmpegCommand().execute({
        args: ["-hide_banner", "-loglevel", "error", "-f", "rawvideo", "-pixel_format", format,
          "-video_size", "4x2", "-framerate", "1", "-i", "/in.raw",
          ...(graph ? ["-filter_complex", `[0:v]${filter}[out]`, "-map", "[out]"] : ["-vf", filter]),
          "-frames:v", "1", "-pix_fmt", outputFormat, "-f", "rawvideo", "pipe:1"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(),
        stdout: { async write(bytes: Uint8Array) { stdout.push(bytes); } },
        stderr: { async write(bytes: Uint8Array) { stderr.push(bytes); } }
      } as never);
      assert.equal(result.exitCode, 0, Buffer.concat(stderr).toString());
      assert.equal(Buffer.concat(stderr).toString(), "");
      assert.equal(Buffer.concat(stdout).toString("hex"), expected);
    });
  }
}
