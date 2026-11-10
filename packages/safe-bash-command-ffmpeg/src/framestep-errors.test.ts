import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

for (const [step, exitCode] of [
  ["0", 222],
  ["-1", 222],
  ["2147483648", 222],
  ["step=0", 222],
  ["bogus", 234],
  ["step=bogus", 234],
  ["step=", 234],
  ["2", 0]
] as const) {
  it(`framestep=${step} returns native exit code ${exitCode}`, async () => {
    const frames = Array.from({ length: 8 }, (_, index) => Buffer.concat([
      Buffer.alloc(4, 32 + 20 * index), Buffer.alloc(8, 128)
    ]));
    const volume = Volume.fromJSON({
      "/in.y4m": Buffer.concat([
        Buffer.from("YUV4MPEG2 W2 H2 F6:1 Ip A1:1 C444\n"),
        ...frames.flatMap(frame => [Buffer.from("FRAME\n"), frame])
      ]),
      "/out.raw": "KEEP"
    });
    const before = volume.toJSON();
    const errors: Uint8Array[] = [];
    const result = await createFfmpegCommand().execute({
      args: ["-v", "error", "-y", "-i", "/in.y4m", "-vf", `framestep=${step}`,
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
    assert.equal(result.exitCode, exitCode, stderr);
    if (exitCode !== 0) {
      assert.ok(stderr.includes("framestep:"), stderr);
      assert.deepEqual(volume.toJSON(), before);
    } else {
      assert.deepEqual(volume.readFileSync("/out.raw"), Buffer.concat([0, 2, 4, 6].map(index => frames[index]!)));
    }
  });
}
