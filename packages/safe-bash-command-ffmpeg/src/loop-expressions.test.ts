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

// Native FFmpeg 7.0.2 rounds integer options to nearest, with ties to even.
for (const graph of [false, true]) {
  for (const [options, expected] of [
    ["1:2:3", [32, 52, 72, 92, 72, 92, 112, 132]],
    ["0.5+0.5:2:3", [32, 52, 72, 92, 72, 92, 112, 132]],
    ["1:2.5:3", [32, 52, 72, 92, 72, 92, 112, 132]],
    ["1:3.5:3", [32, 52, 72, 92, 112, 132, 72, 92, 112, 132]],
    ["1.5:2:3", [32, 52, 72, 92, 72, 92, 72, 92, 112, 132]],
    ["0.5:2:3", source],
    ["-0.5:2:3", source],
    ["1:0.5:3", source],
    ["1:2:2.5", [32, 52, 72, 52, 72, 92, 112, 132]],
    ["1:2:3.5", [32, 52, 72, 92, 112, 92, 112, 132]],
    ["loop=1/1:size=5/2:start=6/2", [32, 52, 72, 92, 72, 92, 112, 132]],
    ["loop=sin(PI/2):size=PHI:start=E", [32, 52, 72, 92, 72, 92, 112, 132]],
    ["1:2:3:loop=0.5+0.5", [32, 52, 72, 92, 72, 92, 112, 132]],
    ...[
      "loop=1+", "loop=", "loop=NaN", "loop=1/0", "loop=0/0",
      "loop=-1.1:size=0", "loop=2147483647.1:size=0", "loop=2147483647+1:size=0",
      "size=-0.1", "size=32767.1", "size=32767+1", "size=1+", "start=1+",
      "loop=1+:loop=1:size=2:start=3"
    ].map(option => [option, null] as const)
  ] as const) {
    it(`${graph ? "graph" : "simple"} loop=${options} ${expected ? "matches native bytes" : "preserves output on rejection"}`, async () => {
      const volume = Volume.fromJSON({ "/in.y4m": input, "/o.raw": "KEEP" });
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-y", "-i", "/in.y4m",
          ...(graph ? ["-filter_complex", `[0:v]loop=${options}[out]`, "-map", "[out]"] : ["-vf", `loop=${options}`]),
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
      if (expected) {
        assert.equal(result.exitCode, 0, stderr);
        assert.deepEqual(volume.readFileSync("/o.raw"), Buffer.concat(expected.map(pixels)));
      } else {
        assert.notEqual(result.exitCode, 0, stderr);
        assert.ok(stderr.includes("loop:"), stderr);
        assert.equal(volume.readFileSync("/o.raw", "utf8"), "KEEP");
      }
      assert.deepEqual(volume.readFileSync("/in.y4m"), input);
    });
  }
}
