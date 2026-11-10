import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const pixels = (value: number) => Buffer.concat([Buffer.alloc(4, value), Buffer.alloc(8, 128)]);
const input = Buffer.concat([
  Buffer.from("YUV4MPEG2 W2 H2 F4:1 Ip A1:1 C444\n"),
  ...[32, 52, 72, 92, 112, 132].flatMap(value => [Buffer.from("FRAME\n"), pixels(value)])
]);

for (const graph of [false, true]) {
  for (const [options, valid] of [
    ...[
      "0b1:2:3", "0B1:2:3", "0o1:2:3", "0O1:2:3",
      "1:0b10:3", "1:0B10:3", "1:0o2:3", "1:0O2:3",
      "1:2:0b11", "1:2:0B11", "1:2:0o3", "1:2:0O3",
      "loop=0b1:size=2:start=3", "loop=1:size=0o2:start=3",
      "loop=1:size=2:start=0b11", "1:2:3:loop=0o1"
    ].map(options => [options, false] as const),
    ...["1:2:3", "0x1:0x2:0x3", "1e0:2e0:3e0", "01:02:03"].map(options => [options, true] as const)
  ]) {
    it(`${graph ? "graph" : "simple"} loop=${options} ${valid ? "preserves native numeric spellings" : "rejects JavaScript number prefixes before writing output"}`, async () => {
      const volume = Volume.fromJSON({ "/in.y4m": input, "/o.raw": "KEEP" });
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-y", "-i", "/in.y4m",
          ...(graph ? ["-filter_complex", `[0:v]loop=${options}[out]`, "-map", "[out]"] : ["-vf", `loop=${options}`]),
          "-fps_mode", "passthrough", "-pix_fmt", "yuv444p", "-f", "rawvideo", "/o.raw"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) {
            assert.ok(valid, "invalid loop options must not open the output");
            volume.writeFileSync(path, bytes);
          },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(), stdout: { async write() {} },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      assert.equal(result.exitCode, valid ? 0 : 234, stderr);
      if (valid) {
        assert.deepEqual(volume.readFileSync("/o.raw"), Buffer.concat([32, 52, 72, 92, 72, 92, 112, 132].map(pixels)));
      } else {
        assert.ok(stderr.includes("loop:"), stderr);
        assert.equal(volume.readFileSync("/o.raw", "utf8"), "KEEP");
      }
      assert.deepEqual(volume.readFileSync("/in.y4m"), input);
    });
  }
}
