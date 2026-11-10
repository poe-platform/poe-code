import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const pixels = (value: number) => Buffer.concat([Buffer.alloc(4, value), Buffer.alloc(8, 128)]);
const input = Buffer.concat([
  Buffer.from("YUV4MPEG2 W2 H2 F4:1 Ip A1:1 C444\n"),
  ...[32, 52, 72, 92, 112, 132].map(value => Buffer.concat([Buffer.from("FRAME\n"), pixels(value)]))
]);

// Native FFmpeg 7.0.2 returns 234 for invalid durations and output placement.
for (const [inputOptions, outputOptions, exitCode] of [
  [["-sseof", "0"], [], 234],
  [["-sseof", "0.25"], [], 234],
  [["-sseof", "bogus"], [], 234],
  [[], ["-sseof", "-0.5"], 234],
  [["-sseof", "-500ms"], [], 0],
  [["-sseof", "-0.5"], [], 0]
] as const) {
  it(`returns ${exitCode} for ${inputOptions.join(" ")} -i in.y4m ${outputOptions.join(" ")}`, async () => {
    const volume = Volume.fromJSON({ "/in.y4m": input, "/o.raw": "KEEP" });
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-v", "error", "-y", ...inputOptions, "-i", "/in.y4m", "-vf", "null",
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
    assert.equal(result.exitCode, exitCode, stderr);
    if (exitCode === 0) {
      assert.deepEqual(volume.readFileSync("/o.raw"), Buffer.concat([112, 132].map(pixels)));
    } else {
      assert.ok(stderr.includes("-sseof"), stderr);
      assert.equal(volume.readFileSync("/o.raw", "utf8"), "KEEP");
    }
    assert.deepEqual(volume.readFileSync("/in.y4m"), input);
  });
}
