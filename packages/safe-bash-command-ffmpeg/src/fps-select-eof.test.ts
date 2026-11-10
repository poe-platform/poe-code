import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2 outputs for six 1x1 gray frames at 5 fps.
for (const [filter, expected] of [
  ["select=eq(n\\,0),fps=5", [20, 20, 20, 20, 20, 20]],
  ["select=lte(n\\,2),fps=5", [20, 40, 60, 60, 60, 60]],
  ["select=not(mod(n\\,2)),fps=5", [20, 20, 60, 60, 100, 100]],
  ["trim=end_frame=3,fps=5", [20, 40, 60]],
  ["select=gte(n\\,3),fps=5", [80, 100, 120]],
  ["select=eq(n\\,0),null,fps=5", [20, 20, 20, 20, 20, 20]],
  ["select=lte(n\\,2),select=eq(n\\,0),fps=5", [20, 20, 20, 20, 20, 20]],
  ["trim=end_frame=3,select=eq(n\\,0),fps=5", [20, 20, 20]],
  ["select=eq(n\\,0),trim=end_frame=3,fps=5", [20, 20, 20, 20, 20, 20]],
  ["select=not(mod(n\\,2)),trim=end_frame=2,fps=5", [20, 20, 60, 60]],
  ["select=eq(n\\,0),setpts=PTS+2,fps=5", [20, 20, 20, 20, 20, 20]],
  ["setpts=PTS+2,select=eq(n\\,0),fps=5", [20, 20, 20, 20, 20, 20]],
  ["select=lte(n\\,2),setpts=2*PTS,fps=5", [20, 20, 40, 40, 60, 60, 60, 60, 60, 60, 60, 60]],
  ["select=eq(n\\,0),fps=2,fps=5", [20, 20, 20, 20, 20]],
  ["select=0,fps=5", []]
] as const) {
  it(`preserves the input EOF through ${filter}`, async () => {
    const volume = Volume.fromJSON({
      "/in.gray": Buffer.from([20, 40, 60, 80, 100, 120]),
      "/out": "KEEP"
    });
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-v", "error", "-y", "-f", "rawvideo", "-pixel_format", "gray",
        "-video_size", "1x1", "-framerate", "5", "-i", "/in.gray", "-vf", filter,
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
