import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const input = Buffer.concat([
  Buffer.from("YUV4MPEG2 W2 H2 F5:1 Ip A1:1 C444\n"),
  ...[[12, 80, 200], [120, 160, 100], [230, 100, 50],
    [70, 40, 250], [100, 60, 90], [40, 220, 30]].flatMap(frame => [
    Buffer.from("FRAME\n"), Buffer.from(frame.flatMap(sample => Array(4).fill(sample)))
  ])
]);
// Complete FFmpeg 7.0.2 output, with each plane containing four identical samples.
const averaged = [[12, 80, 200], [66, 120, 150], [175, 130, 75],
  [150, 70, 150], [85, 50, 170], [70, 140, 60]];
const scaled = [[12, 80, 200], [66, 120, 150], [255, 255, 150],
  [255, 140, 255], [170, 100, 255], [140, 255, 120]];

for (const [filter, expected] of [
  ["tmix=frames=2", averaged],
  ["sendcmd=c=0.4 tmix@v frames 1,tmix@v=frames=2", averaged],
  ["sendcmd=c=0.4 tmix@v missing 1,tmix@v=frames=2", averaged],
  ["sendcmd=c=0.4 tmix@v scale 1,tmix@v=frames=2", scaled],
  ["sendcmd=c='0.2 tmix frames 1;0.4 tmix scale 1;0.6 tmix missing 0',tmix=frames=2", scaled],
  ["sendcmd=c='0.2 tmix@v frames 1;0.4 tmix@v scale 1;0.6 tmix@v missing 0',tmix@v=frames=2", scaled]
] as const) {
  for (const graph of [false, true]) {
    it(`continues rendering after rejected tmix commands (${graph ? "graph" : "simple"}): ${filter}`, async () => {
      const volume = Volume.fromJSON({ "/in.y4m": input, "/out.raw": "KEEP" });
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-y", "-i", "/in.y4m", ...(graph
          ? ["-filter_complex", `[0:v]${filter}[out]`, "-map", "[out]"] : ["-vf", filter]),
        "-fps_mode", "passthrough", "-pix_fmt", "yuv444p", "-f", "rawvideo", "/out.raw"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(), stdout: { async write() {} },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      assert.equal(result.exitCode, 0, stderr);
      assert.deepEqual(volume.readFileSync("/out.raw"),
        Buffer.from(expected.flatMap(frame => frame.flatMap(value => Array(4).fill(value)))));
      assert.deepEqual(volume.readFileSync("/in.y4m"), input);
    });
  }
}
