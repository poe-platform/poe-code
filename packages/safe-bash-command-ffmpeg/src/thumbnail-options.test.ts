import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg: seven 1x1 gray frames at 4 fps, including the final partial batch.
for (const [option, expected] of [
  ["n=3", [40, 200, 240]],
  ["n=1+2", [40, 200, 240]],
  ["1+2", [40, 200, 240]],
  ["n=2.6", [40, 200, 240]],
  ["2.6", [40, 200, 240]],
  ["n=2.5", [40, 100, 200, 240]],
  ["n=3.5", [40, 200]],
  ["n=min", [40, 100, 200, 240]],
  ["n=default", [200]],
  ["n=PI", [40, 200, 240]],
  ["n=1", 222],
  ["n=1.9", 222],
  ["n=2147483647.1", 222],
  ["n=2147483648", 222]
] as const) {
  it(`matches thumbnail AVOption conversion for ${option}`, async () => {
    const volume = Volume.fromJSON({
      "/in.raw": Buffer.from([40, 40, 100, 160, 200, 200, 240]),
      "/out.raw": "KEEP"
    });
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-hide_banner", "-nostats", "-v", "error", "-y", "-f", "rawvideo",
        "-pixel_format", "gray", "-video_size", "1x1", "-framerate", "4", "-i", "/in.raw",
        "-vf", `thumbnail=${option},showinfo`, "-fps_mode", "passthrough",
        "-pix_fmt", "gray", "-f", "rawvideo", "/out.raw"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async writeFile(path: string, data: Uint8Array) { volume.writeFileSync(path, data); },
        async stat(path: string) { return volume.statSync(path); }
      },
      stdin: (async function* () {})(), stdout: { async write() {} },
      stderr: { async write(data: Uint8Array) { stderr += new TextDecoder().decode(data); } }
    } as never);
    assert.equal(result.exitCode, typeof expected === "number" ? expected : 0, stderr);
    assert.deepEqual(volume.readFileSync("/out.raw"),
      typeof expected === "number" ? Buffer.from("KEEP") : Buffer.from(expected));
  });
}
