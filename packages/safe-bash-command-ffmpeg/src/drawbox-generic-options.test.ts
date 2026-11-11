import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

for (const options of [
  "", ":threads=1", ":thread_type=slice", ":extra_hw_frames=1",
  ":threads=0:thread_type=0:extra_hw_frames=-1",
  ":threads=1+1:thread_type=+slice-slice:extra_hw_frames=2",
  ":threads=max:thread_type=all:extra_hw_frames=default"
]) {
  for (const geometry of ["x=1:y=1:w=1:h=1:t=fill:c=white", "1:1:1:1:white:fill"]) {
    it(`drawbox=${geometry}${options} preserves native pixels`, async () => {
      const input = Buffer.from(Array.from({ length: 16 }, (_, i) => (7 + 29 * i) % 256));
      const volume = Volume.fromJSON({ "/in.raw": input });
      const output: Uint8Array[] = [];
      const errors: Uint8Array[] = [];
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-f", "rawvideo", "-pixel_format", "gray", "-video_size", "4x4",
          "-framerate", "2", "-i", "/in.raw", "-vf", `drawbox=${geometry}${options}`,
          "-fps_mode", "passthrough", "-pix_fmt", "gray", "-bitexact", "-f", "rawvideo", "pipe:1"],
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
      assert.equal(result.exitCode, 0, Buffer.concat(errors).toString());
      assert.equal(Buffer.concat(errors).toString(), "");
      // FFmpeg 7.0.2: one white pixel at (1, 1), all other gray samples unchanged.
      assert.equal(Buffer.concat(output).toString("hex"), "0724415e7bffb5d2ef0c294663809dba");
      assert.deepEqual(volume.readFileSync("/in.raw"), input);
    });
  }
}

for (const option of ["threads=-1", "threads=2147483648", "threads=bogus", "threads=nan",
  "thread_type=0.5", "thread_type=bogus", "extra_hw_frames=-2", "extra_hw_frames=bogus"]) {
  it(`rejects drawbox ${option} without replacing output`, async () => {
    const volume = Volume.fromJSON({ "/in.raw": Buffer.alloc(16), "/out.raw": "KEEP" });
    const before = volume.toJSON();
    const errors: Uint8Array[] = [];
    const result = await createFfmpegCommand().execute({
      args: ["-v", "error", "-y", "-f", "rawvideo", "-pixel_format", "gray", "-video_size", "4x4",
        "-i", "/in.raw", "-vf", `drawbox=x=1:y=1:w=1:h=1:t=fill:c=white:${option}`,
        "-pix_fmt", "gray", "-f", "rawvideo", "/out.raw"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
        async stat(path: string) { return volume.statSync(path); }
      },
      stdin: (async function* () {})(), stdout: { async write() {} },
      stderr: { async write(bytes: Uint8Array) { errors.push(bytes); } }
    } as never);
    assert.notEqual(result.exitCode, 0);
    assert.ok(Buffer.concat(errors).toString().includes("drawbox:"));
    assert.deepEqual(volume.toJSON(), before);
  });
}
