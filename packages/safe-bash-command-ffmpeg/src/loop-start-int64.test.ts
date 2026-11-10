import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const frames = [32, 52, 72, 92, 112, 132].map(value =>
  Buffer.concat([Buffer.alloc(4, value), Buffer.alloc(8, 128)]));
const input = Buffer.concat([
  Buffer.from("YUV4MPEG2 W2 H2 F4:1 Ip A1:1 C444\n"),
  ...frames.map(frame => Buffer.concat([Buffer.from("FRAME\n"), frame]))
]);

for (const complex of [false, true]) {
  for (const [filter, valid] of [
    ["null", true],
    ["loop=1:2:100", true],
    ["loop=1:2:9007199254740991", true],
    ["loop=1:2:9007199254740992", true],
    ["loop=1:2:9223372036854775807", true],
    ["loop=1:2:9223372036854775808", true],
    ["loop=loop=1:size=2:start=9223372036854775807", true],
    ["loop=-1:2:9223372036854775807", true],
    ["loop=0:2:9223372036854775807", true],
    ["loop=1:0:9223372036854775807", true],
    ["loop=1:2:9223372036854777856", false],
    ["loop=0:0:18446744073709551616", false],
    ["loop=1:2:Infinity", false],
    ["loop=1:2:NaN", false],
    ["loop=1:2:-2", false],
    ["loop=1:2:1.5+", false]
  ] as const) {
    it(`${complex ? "complex" : "simple"} ${filter} validates int64 starts before preserving frames`, async () => {
      const volume = Volume.fromJSON({ "/in.y4m": input, "/out.raw": "KEEP" });
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-y", "-i", "/in.y4m",
          ...(complex ? ["-filter_complex", `[0:v]${filter}[out]`, "-map", "[out]"] : ["-vf", filter]),
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
      if (valid) {
        assert.equal(result.exitCode, 0, stderr);
        assert.deepEqual(volume.readFileSync("/out.raw"), Buffer.concat(frames));
      } else {
        assert.notEqual(result.exitCode, 0, stderr);
        assert.ok(stderr.includes("loop:"), stderr);
        assert.equal(volume.readFileSync("/out.raw", "utf8"), "KEEP");
      }
      assert.deepEqual(volume.readFileSync("/in.y4m"), input);
    });
  }
}
