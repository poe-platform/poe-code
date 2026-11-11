import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg outputs for six 1x1 gray frames at 4 fps.
for (const [filter, expected] of [
  ["thumbnail=3,fps=3", [10, 10, 100, 100, 100]],
  ["thumbnail=3", [10, 100]],
  ["fps=3", [10, 30, 100, 150, 210]],
  ["thumbnail=4,fps=3", [10, 10, 10, 150, 150]],
  ["select=lt(n\\,3),thumbnail=3,fps=3", [10, 10, 10, 10, 10]],
  ["trim=end_frame=3,thumbnail=3,fps=3", [10, 10]]
] as const) {
  it(`preserves the input EOF through ${filter}`, async () => {
    const volume = Volume.fromJSON({
      "/in.gray": Buffer.from([10, 30, 60, 100, 150, 210]),
      "/out": "KEEP"
    });
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-v", "error", "-y", "-f", "rawvideo", "-pixel_format", "gray",
        "-video_size", "1x1", "-framerate", "4", "-i", "/in.gray", "-vf", filter,
        "-fps_mode", "passthrough", "-pix_fmt", "gray", "-f", "rawvideo", "/out"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async writeFile(path: string, data: Uint8Array) { volume.writeFileSync(path, data); },
        async stat(path: string) { return volume.statSync(path); }
      },
      stdin: (async function* () {})(), stdout: { async write() {} },
      stderr: { async write(data: Uint8Array) { stderr += new TextDecoder().decode(data); } }
    } as never);
    assert.equal(result.exitCode, 0, stderr);
    assert.deepEqual(volume.readFileSync("/out"), Buffer.from(expected));
  });
}
