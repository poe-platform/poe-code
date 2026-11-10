import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const input = Buffer.concat([
  Buffer.from("YUV4MPEG2 W2 H2 F5:1 Ip A1:1 C444\n"),
  ...[16, 17, 18, 30, 90, 235].flatMap(value => [
    Buffer.from("FRAME\n"), Buffer.from([value, 128, 128].flatMap(sample => Array(4).fill(sample)))
  ])
]);
const averaged = [16, 17, 18, 24, 60, 163].map(value => [value, 128, 128]);
// FFmpeg 7.0.2: changing scale at 0.4 seconds preserves the first two frames.
const scaled = [[16, 128, 128], [17, 128, 128], [35, 255, 255],
  [48, 255, 255], [120, 255, 255], [255, 255, 255]];

for (const [filter, expected] of [
  ["tmix=frames=2", averaged],
  ["tmix@instance=frames=1", [16, 17, 18, 30, 90, 235].map(value => [value, 128, 128])],
  ["sendcmd=c=0.4 tmix scale 1,tmix=frames=2", scaled],
  ["sendcmd=c=0.4 tmix@v scale 1,tmix@v=frames=2", scaled],
  ["sendcmd=c=0.4 tmix scale 1,tmix@v=frames=2", scaled],
  ["sendcmd=c=0.4 tmix@other scale 1,tmix@v=frames=2", averaged],
  ["sendcmd=c=0.4 tmix@v scale 1,tmix@other=frames=1,tmix@v=frames=2", scaled],
  ["sendcmd=c=0.4 tmix scale 1,tmix@v=frames=2,tmix@other=frames=1", scaled],
  ["sendcmd=c=0.4 tmix scale 1,tmix@a=frames=2,tmix@b=frames=2",
    [[16, 128, 128], [17, 128, 128], [26, 192, 192], [42, 255, 255], [84, 255, 255], [188, 255, 255]]],
  ["sendcmd=c=0.4 tmix@b scale 1,tmix@a=frames=2,tmix@b=frames=2",
    [[16, 128, 128], [17, 128, 128], [35, 255, 255], [42, 255, 255], [84, 255, 255], [223, 255, 255]]],
  ["sendcmd=c='0.4 tmix@v scale 1;0.8 negate@n components y',tmix@v=frames=2,negate@n=components=0",
    [...scaled.slice(0, 4), [135, 255, 255], [0, 255, 255]]],
  ["sendcmd=c=0.41 tmix scale 1,tmix=frames=2", [...averaged.slice(0, 3), ...scaled.slice(3)]],
  ["setpts=PTS+2/TB,sendcmd=commands='2.4 [enter] tmix@v scale 1',tmix@v=frames=2", scaled],
  // Native averaging retains its accumulator while explicit scaling is active.
  ["sendcmd=c='0.4 tmix scale 1;0.8 tmix scale 0',tmix=frames=2", [...scaled.slice(0, 4), [54, 128, 128], [156, 128, 128]]],
  ["sendcmd=c=0.4 tmix scale 1/2,tmix=frames=2", averaged],
  ["sendcmd=c='0.4 tmix scale 1;0.6 tmix scale invalid',tmix=frames=2", scaled],
  ["sendcmd=c='0.4 tmix scale 1;0.6 tmix scale -1;0.8 tmix scale 32768',tmix=frames=2", scaled],
  ["sendcmd=c='0.8 tmix scale 1;0.4 tmix scale 1',tmix=frames=2", scaled],
  ["tmix=frames=2:scale=1", [[32, 255, 255], [33, 255, 255], ...scaled.slice(2)]],
  ["sendcmd=c=bad tmix scale 1,tmix=frames=2", null],
  ["tmix=frames=2:scale=invalid", null]
] as const) {
  for (const graph of [false, true]) {
    it(`timed tmix (${graph ? "graph" : "simple"}): ${filter}`, async () => {
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
      if (expected === null) {
        assert.notEqual(result.exitCode, 0);
        assert.equal(volume.readFileSync("/out.raw", "utf8"), "KEEP");
      } else {
        assert.equal(result.exitCode, 0, stderr);
        assert.deepEqual(volume.readFileSync("/out.raw"),
          Buffer.from(expected.flatMap(frame => frame.flatMap(value => Array(4).fill(value)))));
      }
      assert.deepEqual(volume.readFileSync("/in.y4m"), input);
    });
  }
}
