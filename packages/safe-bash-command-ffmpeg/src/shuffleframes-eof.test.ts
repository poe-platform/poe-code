import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const values = [16, 32, 48, 64, 80, 96, 112, 128, 144, 160];
const frame = (value: number) => Buffer.concat([Buffer.alloc(1024, value), Buffer.alloc(512, 128)]);

for (const graph of [false, true]) {
  for (const [filter, expected] of [
    ["shuffleframes=0 1 2,fps=10", [...values.slice(0, 9), 144]],
    ["shuffleframes=0 1 2", values.slice(0, 9)],
    ["shuffleframes=0 -1,fps=10", [16, 16, 48, 48, 80, 80, 112, 112, 144, 144]],
    ["shuffleframes=0 1,fps=10", values],
    ["shuffleframes=-1,fps=10", []],
    ["select='lt(n,9)',shuffleframes=0 1 2,fps=10", [...values.slice(0, 9), 144]]
  ] as const) {
    it(`preserves shuffleframes EOF timing: ${filter} (${graph ? "graph" : "simple"})`, async () => {
      const volume = Volume.fromJSON({ "/in.yuv": Buffer.concat(values.map(frame)) });
      const output: Uint8Array[] = [];
      const errors: Uint8Array[] = [];
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-f", "rawvideo", "-pixel_format", "yuv420p", "-video_size", "32x32",
          "-framerate", "10", "-i", "/in.yuv",
          ...(graph ? ["-filter_complex", `[0:v]${filter}[out]`, "-map", "[out]"] : ["-vf", filter]),
          "-fps_mode", "passthrough", "-pix_fmt", "yuv420p", "-f", "rawvideo", "pipe:1"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(),
        stdout: { async write(bytes: Uint8Array) { output.push(bytes); } },
        stderr: { async write(bytes: Uint8Array) { errors.push(bytes); } }
      } as never);
      assert.equal(result.exitCode, 0, Buffer.concat(errors).toString());
      assert.equal(Buffer.concat(output).length, expected.length * 1536);
      assert.deepEqual(Buffer.concat(output), Buffer.concat(expected.map(frame)));
    });
  }
}
