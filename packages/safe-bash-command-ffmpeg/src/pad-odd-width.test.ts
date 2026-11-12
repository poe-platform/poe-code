import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Complete raw frames from native FFmpeg 7.0.2, including luma and chroma.
for (const [format, size, samples, filter, expected] of [
  ["yuv420p", "5x3", 27, "pad=8:6:0:0", "111c27321010101048535e69101010107f8a95a010101010101010101010101010101010101010101010101010101010b6c18080d7e2808080808080f80380801924808080808080"],
  ["yuv420p", "5x4", 32, "pad=8:6:0:0", "111c27321010101048535e69101010107f8a95a010101010b6c1ccd71010101010101010101010101010101010101010edf880800e198080808080802f3a8080505b808080808080"],
  ["yuv422p", "5x3", 33, "pad=8:6:2:2", "101010101010101010101010101010101010111c27321010101048535e69101010107f8a95a010101010101010101010808080808080808080b6c18080d7e28080f8038080808080808080808080808080192480803a4580805b668080808080"],
  ["nv12", "5x3", 27, "pad=8:6:0:0", "111c27321010101048535e69101010107f8a95a010101010101010101010101010101010101010101010101010101010b6c1ccd780808080f8030e19808080808080808080808080"],
  ["yuv420p", "4x3", 20, "pad=8:6:0:0", "111c2732101010103d48535e1010101069747f8a1010101010101010101010101010101010101010101010101010101095a08080abb6808080808080c1cc8080d7e2808080808080"],
  ["gray", "5x3", 15, "pad=8:6:0:0", "111c27323d00000048535e69740000007f8a95a0ab000000000000000000000000000000000000000000000000000000"]
] as const) {
  it(`matches native right-edge padding for ${format} ${size} with ${filter}`, async () => {
    const volume = Volume.fromJSON({
      "/in.raw": Buffer.from(Array.from({ length: samples }, (_, i) => (11 * i + 17) % 256))
    });
    const stdout: Uint8Array[] = [];
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-hide_banner", "-loglevel", "error", "-f", "rawvideo", "-pixel_format", format,
        "-video_size", size, "-framerate", "1", "-i", "/in.raw", "-vf", filter,
        "-frames:v", "1", "-pix_fmt", format, "-f", "rawvideo", "pipe:1"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
        async stat(path: string) { return volume.statSync(path); }
      },
      stdin: (async function* () {})(),
      stdout: { async write(bytes: Uint8Array) { stdout.push(bytes); } },
      stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
    } as never);
    assert.equal(result.exitCode, 0, stderr);
    assert.equal(stderr, "");
    assert.equal(Buffer.concat(stdout).toString("hex"), expected);
  });
}
