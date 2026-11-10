import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const source = [32, 52, 72, 92, 112, 132];
const pixels = (value: number) => Buffer.concat([Buffer.alloc(4, value), Buffer.alloc(8, 128)]);
const input = Buffer.concat([
  Buffer.from("YUV4MPEG2 W2 H2 F4:1 Ip A1:1 C444\n"),
  ...source.map(value => Buffer.concat([Buffer.from("FRAME\n"), pixels(value)]))
]);

for (const graph of [false, true]) {
  for (const [filter, outputOptions, succeeds] of [
    ["loop=-1:0:0", [], true],
    ["loop=-1:2:100", ["-frames:v", "8"], true],
    ["loop=-1:2:100", [], true],
    ["loop=-1:2:7", [], true],
    ["loop=loop=-1:size=0:start=0", [], true],
    ["loop=loop=-1:size=2:start=100", ["-frames:v", "8"], true],
    ["null", [], true],
    ["loop=1:2:100", [], true],
    ["loop=-1:2:6", [], false],
    ["loop=-2:0:0", [], false],
    ["loop=-1:0:-1", [], false]
  ] as const) {
    it(`${graph ? "graph" : "simple"} ${filter} ${outputOptions.join(" ")} ${succeeds ? "passes through without replay" : "rejects unsafe looping"}`, async () => {
      const volume = Volume.fromJSON({ "/in.y4m": input, "/o.raw": "KEEP" });
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-y", "-i", "/in.y4m",
          ...(graph ? ["-filter_complex", `[0:v]${filter}[out]`, "-map", "[out]"] : ["-vf", filter]),
          ...outputOptions, "-fps_mode", "passthrough", "-pix_fmt", "yuv444p", "-f", "rawvideo", "/o.raw"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(), stdout: { async write() {} },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      if (succeeds) {
        assert.equal(result.exitCode, 0, stderr);
        assert.deepEqual(volume.readFileSync("/o.raw"), Buffer.concat(source.map(pixels)));
      } else {
        assert.notEqual(result.exitCode, 0, stderr);
        assert.ok(stderr.includes("loop:"), stderr);
        assert.equal(volume.readFileSync("/o.raw", "utf8"), "KEEP");
      }
      assert.deepEqual(volume.readFileSync("/in.y4m"), input);
    });
  }
}
