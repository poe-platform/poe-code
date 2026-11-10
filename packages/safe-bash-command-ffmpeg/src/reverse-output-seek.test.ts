import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const values = [32, 52, 72, 92, 112, 132];
const frames = (luma: readonly number[]) => Buffer.concat(luma.map(value =>
  Buffer.from([...Array(4).fill(value), ...Array(8).fill(128)])));
const input = Buffer.concat([Buffer.from("YUV4MPEG2 W2 H2 F4:1 Ip A1:1 C444\n"),
  ...values.flatMap(value => [Buffer.from("FRAME\n"), frames([value])])]);

// Native FFmpeg 7 reference pictures, including independent input and output seeks.
for (const [before, filter, after, expected] of [
  [[], "reverse", ["-ss", "1"], [52, 32]],
  [["-ss", "0.25"], "reverse", ["-ss", "0.5"], [92, 72, 52]],
  [["-ss", "1"], "reverse", [], [132, 112]],
  [[], "null", ["-ss", "1"], [112, 132]],
  [[], "reverse,trim=start_frame=4", [], [52, 32]],
] as const) {
  it(`video output seek: ${before.join(" ")} -vf ${filter} ${after.join(" ")}`, async () => {
    const volume = Volume.fromJSON({ "/in.y4m": input, "/o.raw": "KEEP" });
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-v", "error", "-y", ...before, "-i", "/in.y4m", "-vf", filter, ...after,
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
    assert.deepEqual(volume.readFileSync("/o.raw"), frames(expected));
    assert.deepEqual(volume.readFileSync("/in.y4m"), input);
  });
}
