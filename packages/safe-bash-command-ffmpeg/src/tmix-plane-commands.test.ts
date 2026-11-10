import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const samples = [[12, 80, 200], [120, 160, 100], [230, 100, 50],
  [70, 40, 250], [100, 60, 90], [40, 220, 30]];
const input = Buffer.concat([
  Buffer.from("YUV4MPEG2 W2 H2 F5:1 Ip A1:1 C444\n"),
  ...samples.flatMap(frame => [Buffer.from("FRAME\n"),
    Buffer.from(frame.flatMap(value => Array(4).fill(value)))])
]);
// Complete output from Linux FFmpeg 7.0.2, including the history before the command.
const timed = [[12, 80, 200], [66, 120, 150], [175, 160, 100],
  [150, 100, 50], [85, 40, 250], [70, 60, 90]];
const averaged = [[12, 80, 200], [66, 120, 150], [175, 130, 75],
  [150, 70, 150], [85, 50, 170], [70, 140, 60]];

for (const [filter, expected] of [
  ["sendcmd=c=0.4 tmix planes 1,tmix=frames=2", timed],
  ["sendcmd=c=0.4 tmix@v planes 1,tmix@v=frames=2", timed],
  ["sendcmd=c=0.4 tmix planes 1,tmix@v=frames=2", timed],
  ["sendcmd=c=0.4 tmix@other planes 1,tmix@v=frames=2", averaged],
  ["sendcmd=c=0.41 tmix planes 1,tmix=frames=2", [...averaged.slice(0, 3), ...timed.slice(3)]],
  ["sendcmd=c='0.4 tmix planes 1;0.6 tmix planes invalid',tmix=frames=2", timed],
  ["sendcmd=c=0.4 tmix planes -6,tmix=frames=2", timed],
  ["sendcmd=c='0.4 tmix planes 1;0.8 tmix scale 1',tmix=frames=2",
    [...timed.slice(0, 4), [170, 40, 250], [140, 60, 90]]],
  ["tmix=frames=2:planes=1", [timed[0]!, [66, 80, 200], ...timed.slice(2)]],
  ["sendcmd=c=0.4 tmix scale 1,tmix=frames=2", [timed[0]!, timed[1]!,
    [255, 255, 150], [255, 140, 255], [170, 100, 255], [140, 255, 120]]]
] as const) {
  for (const graph of [false, true]) {
    it(`tmix timed plane selection (${graph ? "graph" : "simple"}): ${filter}`, async () => {
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
