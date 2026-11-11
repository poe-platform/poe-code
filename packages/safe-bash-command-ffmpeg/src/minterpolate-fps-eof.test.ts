import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2 results for ten uniform 4x4 grayscale frames at 10 Hz.
for (const [filter, expected] of [
  ["minterpolate=fps=20:mi_mode=dup,fps=10", [16, 32, 48, 64, 80, 96, 112, 128, 144, 144]],
  ["minterpolate=fps=20:mi_mode=dup", [16, 16, 32, 32, 48, 48, 64, 64, 80, 80, 96, 96, 112, 112, 128, 128, 144]],
  ["fps=10", [16, 32, 48, 64, 80, 96, 112, 128, 144, 160]]
] as const) {
  it(`preserves native final frame interval through ${filter}`, async () => {
    const volume = Volume.fromJSON({
      "/in.gray": Buffer.concat(Array.from({ length: 10 }, (_, i) => Buffer.alloc(16, (i + 1) * 16)))
    });
    const chunks: Uint8Array[] = [];
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-v", "error", "-f", "rawvideo", "-pixel_format", "gray", "-video_size", "4x4",
        "-framerate", "10", "-i", "/in.gray", "-vf", filter, "-fps_mode", "passthrough",
        "-pix_fmt", "gray", "-f", "rawvideo", "pipe:1"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
        async stat(path: string) { return volume.statSync(path); }
      },
      stdin: (async function* () {})(),
      stdout: { async write(bytes: Uint8Array) { chunks.push(bytes); } },
      stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
    } as never);
    assert.equal(result.exitCode, 0, stderr);
    assert.deepEqual(Buffer.concat(chunks), Buffer.concat(expected.map(value => Buffer.alloc(16, value))));
  });
}
