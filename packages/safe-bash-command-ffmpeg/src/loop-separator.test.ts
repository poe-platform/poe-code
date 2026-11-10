import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const pixels = (value: number) => Buffer.concat([Buffer.alloc(4, value), Buffer.alloc(8, 128)]);
const input = Buffer.concat([
  Buffer.from("YUV4MPEG2 W2 H2 F4:1 Ip A1:1 C444\n"),
  ...[32, 52, 72, 92, 112, 132].map(value => Buffer.concat([Buffer.from("FRAME\n"), pixels(value)]))
]);
const expected = Buffer.concat([32, 52, 72, 92, 72, 92, 112, 132].map(pixels));

for (const graph of [false, true]) {
  for (const [options, valid] of [
    ["1:2:3", true],
    ["1:2:3:", true],
    ["loop=1:size=2:start=3:", true],
    ["1:2:3::", false],
    ["1::3:", false],
    ["1:2:3:4:5:", false]
  ] as const) {
    it(`${graph ? "graph" : "simple"} loop=${options} ${valid ? "matches native bytes" : "preserves output on rejection"}`, async () => {
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
      if (valid) {
        assert.equal(result.exitCode, 0, stderr);
        assert.deepEqual(volume.readFileSync("/o.raw"), expected);
      } else {
        assert.notEqual(result.exitCode, 0, stderr);
        assert.ok(stderr.includes("loop:"), stderr);
        assert.equal(volume.readFileSync("/o.raw", "utf8"), "KEEP");
      }
      assert.deepEqual(volume.readFileSync("/in.y4m"), input);
    });
  }
}
