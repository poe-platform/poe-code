import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Native Linux FFmpeg 7.0.2 rejects invalid pad expressions with EINVAL (234).
for (const [filter, exitCode] of [
  ["pad=4:2:x=NAN", 234],
  ["pad=4:2:x=unknown", 234],
  ["pad=4:2:x=(1", 234],
  ["pad=4:2:y=NAN", 234],
  ["pad=4:2:y=unknown", 234],
  ["pad=4:2:y=(1", 234],
  ["pad=4:2:NAN:0", 234],
  ["pad=4:2:0:unknown", 234],
  ["pad=1:1", 234],
  ["pad=4:2:unknown=1", 8],
  ["pad=4:2:x=1", 0]
] as const) {
  for (const option of ["-vf", "-filter_complex"]) {
    it(`${option} ${filter} returns status ${exitCode} with the expected stdout`, async () => {
      const volume = Volume.fromJSON({ "/in.raw": Buffer.from([13, 20, 27, 34]) });
      const before = volume.toJSON();
      const output: Uint8Array[] = [];
      const errors: Uint8Array[] = [];
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-f", "rawvideo", "-pix_fmt", "gray", "-s", "2x2",
          "-i", "/in.raw", option, filter, "-pix_fmt", "gray", "-f", "rawvideo", "pipe:1"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(),
        stdout: { async write(bytes: Uint8Array) { output.push(bytes); } },
        stderr: { async write(bytes: Uint8Array) { errors.push(bytes); } }
      } as never);
      assert.deepEqual(volume.toJSON(), before);
      assert.deepEqual(Buffer.concat(output), Buffer.from(exitCode === 0 ? [0, 13, 20, 0, 0, 27, 34, 0] : []));
      assert.equal(result.exitCode, exitCode, Buffer.concat(errors).toString());
      if (exitCode !== 0) assert.ok(Buffer.concat(errors).length > 0);
    });
  }
}
