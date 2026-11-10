import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const values = [32, 52, 72, 92, 112, 132];
const frames = (luma: readonly number[]) => Buffer.concat(luma.map(value =>
  Buffer.from([...Array(4).fill(value), ...Array(8).fill(128)])));
const input = Buffer.concat([Buffer.from("YUV4MPEG2 W2 H2 F4:1 Ip A1:1 C444\n"),
  ...values.flatMap(value => [Buffer.from("FRAME\n"), frames([value])])]);

for (const graph of [false, true]) {
  for (const [filter, expected] of [
    ["null", values],
    ["loop=1:2:-1", values],
    ["loop=time=500ms:start=-1:size=2:loop=1", [32, 52, 72, 92, 72, 92, 112, 132]],
    ["loop=loop=1:size=2:start=-1:time=0.9", [...values, 112, 132]],
    ["loop=loop=1:size=2:start=-1:time=2", values],
    ["loop=loop=1:size=2:start=3:time=2", [32, 52, 72, 92, 72, 92, 112, 132]],
    ["loop=1:2:3", [32, 52, 72, 92, 72, 92, 112, 132]],
    ["loop=1:2:-1:0", [32, 52, 32, 52, 72, 92, 112, 132]],
    ["setpts=PTS+4,loop=1:2:-1:500ms", [32, 52, 32, 52, 72, 92, 112, 132]],
    ["loop=1:2:-2", null],
    ["loop=1:2:-1:bad", null],
    ["loop=1:2:-1:-1", null]
  ] as const) {
    it(`${filter} selects video loop start (${graph ? "complex" : "simple"})`, async () => {
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
      assert.equal(result.exitCode === 0, expected !== null, stderr);
      assert.deepEqual(volume.readFileSync("/o.raw"), expected === null ? Buffer.from("KEEP") : frames(expected));
      assert.deepEqual(volume.readFileSync("/in.y4m"), input);
    });
  }
}
