import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const input = Buffer.from(Array.from({ length: 60 }, (_, i) => i));

// Complete RGB24 frame sequences from native FFmpeg 7.0.2.
for (const [options, frames] of [
  ["st(0\\,2)+ld(0)", [0, 1, 3, 4]],
  ["4", [0, 1, 3, 4]],
  ["3:round=st(0\\,3)", [0, 1, 3]],
  ["3:round=up", [0, 1, 3]],
  ["3:start_time=st(0\\,1)/5", [1, 3]],
  ["3:start_time=0.2", [1, 3]],
  ["3:eof_action=st(0\\,1)", [0, 2, 4]],
  ["3:eof_action=pass", [0, 2, 4]],
  ["4+ld(0):start_time=st(0\\,0):round=st(0\\,5):eof_action=ld(0)", [0, 1, 3, 4]]
] as const) {
  for (const graph of [false, true]) {
    it(`fps registers match raw frames (${graph ? "graph" : "simple"}): ${options}`, async () => {
      const volume = Volume.fromJSON({ "/in.rgb": input });
      const stdout: Uint8Array[] = [];
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-f", "rawvideo", "-pixel_format", "rgb24",
          "-video_size", "2x2", "-framerate", "5", "-i", "/in.rgb", ...(graph
            ? ["-filter_complex", `[0:v]fps=${options}[out]`, "-map", "[out]"]
            : ["-vf", `fps=${options}`]),
          "-fps_mode", "passthrough", "-c:v", "rawvideo", "-pix_fmt", "rgb24", "-f", "rawvideo", "pipe:1"],
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
      assert.deepEqual(Buffer.concat(stdout), Buffer.concat(frames.map(i => input.subarray(i * 12, (i + 1) * 12))));
    });
  }
}
