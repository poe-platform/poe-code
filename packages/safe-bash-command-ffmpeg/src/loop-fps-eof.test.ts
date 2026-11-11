import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Complete rawvideo outputs verified with native FFmpeg.
for (const graph of [false, true]) {
  for (const [filter, expected] of [
    ["loop=1:2:1,fps=3", [10, 30, 30, 60, 100, 210, 210, 210]],
    ["loop=1:2:1", [10, 30, 10, 30, 60, 100, 150, 210]],
    ["fps=3", [10, 30, 100, 150, 210]],
    ["loop=2:2:1,fps=3", [10, 30, 30, 10, 30, 100, 150, 210, 210]],
    ["loop=1:20:3,fps=3", [10, 30, 100, 150, 210, 100, 150, 210, 210, 210, 210]],
    ["loop=0:2:1,fps=3", [10, 30, 100, 150, 210]],
    ["loop=1:0:1,fps=3", [10, 30, 100, 150, 210]],
    ["loop=1:2:20,fps=3", [10, 30, 100, 150, 210]],
    ["select=lte(n\\,2),loop=1:2:1,fps=3", [10, 30, 30, 60, 60, 60, 60, 60]],
    ["loop=1:2:1,loop=1:2:1,fps=3", [10, 30, 30, 10, 30, 100, 150, 210, 210, 210, 210]]
  ] as const) {
    it(`${graph ? "graph" : "simple"} preserves EOF through ${filter}`, async () => {
      const volume = Volume.fromJSON({
        "/in.gray": Buffer.from([10, 30, 60, 100, 150, 210]),
        "/out": "KEEP"
      });
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-y", "-f", "rawvideo", "-pixel_format", "gray",
          "-video_size", "1x1", "-framerate", "4", "-i", "/in.gray",
          ...(graph ? ["-filter_complex", `[0:v]${filter}[out]`, "-map", "[out]"] : ["-vf", filter]),
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
}
