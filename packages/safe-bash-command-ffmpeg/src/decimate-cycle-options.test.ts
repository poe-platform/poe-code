import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const levels = [20, 50, 65, 100, 140, 170, 180, 205, 221];
const cycle3 = [1, 2, 3, 5, 7, 8];
const cycle5 = [0, 1, 2, 3, 5, 6, 7, 8];
for (const [options, expected] of [
  ["cycle=3", cycle3],
  ["cycle=3:", cycle3],
  ["3:", cycle3],
  ["cycle=4:cycle=3", cycle3],
  ["4:cycle=3:", cycle3],
  ["cycle=5", cycle5],
  ["cycle=4:cycle=5", cycle5],
  ["cycle=4:cycle=5:", cycle5],
  ["cycle=3:unknown=1:", null],
  ["cycle=3:cycle=", null],
  ["cycle=3:cycle=26:", null],
  ["cycle=3::", null],
  ["cycle=3::cycle=5", null],
  ["cycle=3:1:", null]
] as const) {
  it(`decimate cycle fields match native FFmpeg: ${options}`, async () => {
    const frames = levels.map(value => Buffer.concat([
      Buffer.alloc(32 * 32, value), Buffer.alloc(32 * 32 * 2, 128)
    ]));
    const volume = Volume.fromJSON({
      "/unique.y4m": Buffer.concat([
        Buffer.from("YUV4MPEG2 W32 H32 F10:1 Ip A1:1 C444\n"),
        ...frames.flatMap(frame => [Buffer.from("FRAME\n"), frame])
      ]),
      "/out.raw": "KEEP"
    });
    const before = volume.toJSON();
    const errors: Uint8Array[] = [];
    const result = await createFfmpegCommand().execute({
      args: ["-v", "error", "-y", "-i", "/unique.y4m", "-vf", `decimate=${options}`,
        "-fps_mode", "passthrough", "-pix_fmt", "yuv444p", "-f", "rawvideo", "/out.raw"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
        async stat(path: string) { return volume.statSync(path); }
      },
      stdin: (async function* () {})(),
      stdout: { async write() {} },
      stderr: { async write(bytes: Uint8Array) { errors.push(bytes); } }
    } as never);
    const stderr = Buffer.concat(errors).toString();
    if (expected === null) {
      assert.notEqual(result.exitCode, 0, stderr);
      assert.ok(stderr.includes("decimate:"), stderr);
      assert.deepEqual(volume.toJSON(), before);
    } else {
      assert.equal(result.exitCode, 0, stderr);
      assert.deepEqual(volume.readFileSync("/out.raw"), Buffer.concat(expected.map(i => frames[i]!)));
    }
  });
}
