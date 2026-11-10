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
  for (const [filter, exitCode, expected] of [
    ["loop=oops", 234, null],
    ["loop=1:32768:3", 222, null],
    ["loop=1:2:3:0:1", 234, null],
    ["loop=bad=1", 8, null],
    ["loop=1:2:3", 0, [32, 52, 72, 92, 72, 92, 112, 132]],
  ] as const) {
    it(`${filter} returns native loop status and preserves destination (${graph ? "complex" : "simple"})`, async () => {
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
      assert.equal(result.exitCode, exitCode, stderr);
      assert.deepEqual(volume.readFileSync("/o.raw"), expected === null ? Buffer.from("KEEP") : frames(expected));
      assert.deepEqual(volume.readFileSync("/in.y4m"), input);
    });
  }
}
