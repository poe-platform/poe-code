import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const gray = [16, 17, 18, 30, 90, 235];
const input = Buffer.concat([
  Buffer.from("YUV4MPEG2 W2 H2 F5:1 Ip A1:1 C444\n"),
  ...gray.flatMap(y => [Buffer.from("FRAME\n"), Buffer.from([y, 128, 128].flatMap(value => Array(4).fill(value)))])
]);

// FFmpeg 7.0.2 reference samples and weighted arithmetic, including startup padding and clipping.
for (const [filter, luma, chroma] of [
  ["null", gray, 128],
  ["tmix=frames=2", [16, 17, 18, 24, 60, 163], 128],
  ["tmix=frames=2:scale=1", [32, 33, 35, 48, 120, 255], 255],
  ["tmix=frames=2:scale=0.25", [8, 8, 9, 12, 30, 81], 64],
  ["tmix=frames=2:scale=0", [16, 17, 18, 24, 60, 163], 128],
  ["tmix=frames=2:scale=0.5", [16, 17, 18, 24, 60, 163], 128],
  ["tmix=frames=2:weights=0:scale=1", [0, 0, 0, 0, 0, 0], 0],
  ["tmix=2:1:0.25", [8, 8, 9, 12, 30, 81], 64],
  ["tmix=frames=2:weights=1 2:scale=0.25", [12, 12, 13, 20, 52, 140], 96],
  ["tmix=frames=2:weights=-1 1:scale=1", [0, 1, 1, 12, 60, 145], 0],
  ...["NaN", "Infinity", "no", "32768", "-1"].map(scale => [`tmix=frames=2:scale=${scale}`, null, 0] as const)
] as const) {
  it(`mixes YUV samples before conversion: ${filter}`, async () => {
    const volume = Volume.fromJSON({ "/gray.y4m": input, "/out.raw": "KEEP" });
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-v", "error", "-y", "-i", "/gray.y4m", "-vf", filter,
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
    if (luma === null) {
      assert.notEqual(result.exitCode, 0);
      assert.ok(stderr.includes("tmix:"), stderr);
      assert.equal(volume.readFileSync("/out.raw", "utf8"), "KEEP");
    } else {
      assert.equal(result.exitCode, 0, stderr);
      assert.deepEqual(volume.readFileSync("/out.raw"),
        Buffer.from(luma.flatMap(y => [y, chroma, chroma].flatMap(value => Array(4).fill(value)))));
    }
  });
}
