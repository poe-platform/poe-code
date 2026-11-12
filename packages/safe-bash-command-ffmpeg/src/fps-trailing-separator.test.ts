import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2 frame indices for five 2x2 RGB24 frames at 5 fps.
for (const graph of [false, true]) {
  for (const [filter, exitCode, frames] of [
    ["fps=3:", 0, [0, 2, 4]],
    ["fps=3", 0, [0, 2, 4]],
    ["fps=3:round=up:", 0, [0, 1, 3]],
    ["fps=3:round=up", 0, [0, 1, 3]],
    ["fps=3:round=", 234, []],
    ["fps=3::", 234, []]
  ] as const) {
    it(`matches native trailing separator handling for ${filter} (graph=${graph})`, async () => {
      const input = Buffer.from(Array.from({ length: 60 }, (_, i) => i));
      const volume = Volume.fromJSON({ "/in.rgb": input });
      const stdout: Uint8Array[] = [];
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-f", "rawvideo", "-pixel_format", "rgb24",
          "-video_size", "2x2", "-framerate", "5", "-i", "/in.rgb",
          ...(graph ? ["-filter_complex", `[0:v]${filter}[out]`, "-map", "[out]"] : ["-vf", filter]),
          "-fps_mode", "passthrough", "-c:v", "rawvideo", "-pix_fmt", "rgb24", "-f", "rawvideo", "pipe:1"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(),
        stdout: { async write(bytes: Uint8Array) { stdout.push(bytes.slice()); } },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      assert.equal(result.exitCode, exitCode, stderr);
      assert.deepEqual(Buffer.concat(stdout), Buffer.concat(frames.map(frame => input.subarray(frame * 12, (frame + 1) * 12))));
      assert.deepEqual(volume.readFileSync("/in.rgb"), input);
    });
  }
}
