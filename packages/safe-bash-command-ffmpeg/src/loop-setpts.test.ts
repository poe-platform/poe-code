import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const source = [32, 52, 72, 92, 112, 132];
const pixels = (values: readonly number[]) => Buffer.concat(values.map(value =>
  Buffer.concat([Buffer.alloc(4, value), Buffer.alloc(8, 128)])));
const input = Buffer.concat([
  Buffer.from("YUV4MPEG2 W2 H2 F4:1 Ip A1:1 C444\n"),
  ...source.map(value => Buffer.concat([Buffer.from("FRAME\n"), pixels([value])]))
]);

// Expected pictures verified with native FFmpeg 7.0.2, at four frames per second.
for (const graph of [false, true]) {
  for (const [filter, expected] of [
    ["setpts=2*PTS,loop=1:2:3,select='eq(t,1)'", [72, 72]],
    ["setpts=2*PTS,loop=1:2:3,select='eq(t,1.5)'", [92, 92]],
    ["setpts=2*PTS,loop=1:2:3,select='eq(t,2)'", [112]],
    ["setpts=2*PTS,loop=1:2:3,select='eq(t,2.5)'", [132]],
    ["setpts=PTS+2/TB,loop=1:2:3,select='eq(t,2.5)'", [72, 72]],
    ["setpts=PTS+2/TB,loop=1:2:3,select='eq(t,3)'", [112]],
    ["setpts=PTS+2/TB,loop=1:2:3,select='eq(t,3.25)'", [132]],
    ["setpts=PTS+2/TB,loop=1:2:3,select='eq(t,1)'", []],
    ["setpts=2*PTS,loop=2:2:3,select='eq(t,1)'", [72, 72, 72]],
    ["setpts=2*PTS,loop=2:2:3,select='eq(t,2)'", [112]],
    ["setpts=2*PTS,loop=1:20:3,select='eq(t,2.5)'", [132, 132]],
    ["setpts=2*PTS,loop=1:2:3", [32, 52, 72, 92, 72, 92, 112, 132]],
    ["setpts=2*PTS,select='eq(t,1)'", [72]],
    ["setpts=2*PTS,select='eq(t,2)'", [112]],
    ["setpts=PTS+2/TB,select='eq(t,2.5)'", [72]],
    ["loop=1:2:3,select='eq(t,1)'", [72]],
    ["setpts=PTS,fps=4,loop=1:2:3,select='eq(t,1)'", [72]],
    ["select='not(mod(n,2))',loop=1:2:0,select='eq(t,0.5)'", [72, 32]]
  ] as const) {
    it(`${graph ? "graph" : "simple"} ${filter} preserves native loop timestamps`, async () => {
      const volume = Volume.fromJSON({ "/in.y4m": input, "/o.raw": "KEEP" });
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-y", "-i", "/in.y4m",
          ...(graph ? ["-filter_complex", `[0:v]${filter}[out]`, "-map", "[out]"] : ["-vf", filter]),
          "-fps_mode", "passthrough", "-pix_fmt", "yuv444p", "-f", "rawvideo", "/o.raw"],
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
      assert.deepEqual(volume.readFileSync("/o.raw"), pixels(expected));
      assert.deepEqual(volume.readFileSync("/in.y4m"), input);
    });
  }
}
