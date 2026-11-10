import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

for (const filter of ["pad", "pad=", "pad=iw:ih", "pad=0:0"]) {
  it(`${filter} preserves input dimensions and RGBA pixels`, async () => {
    const input = Buffer.from("321ed4ff78b43c80508cbe40122fc700", "hex");
    const volume = Volume.fromJSON({ "/in.rgba": input, "/o.raw": "KEEP" });
    const errors: Uint8Array[] = [];
    const result = await createFfmpegCommand().execute({
      args: [
        "-v", "error", "-y", "-f", "rawvideo", "-pixel_format", "rgba",
        "-video_size", "2x2", "-framerate", "4", "-i", "in.rgba",
        "-vf", filter, "-fps_mode", "passthrough", "-pix_fmt", "rgba",
        "-f", "rawvideo", "o.raw"
      ],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
        async stat(path: string) { return volume.statSync(path); }
      },
      stdin: (async function* () {})(), stdout: { async write() {} },
      stderr: { async write(bytes: Uint8Array) { errors.push(bytes); } }
    } as never);
    assert.equal(result.exitCode, 0, Buffer.concat(errors).toString());
    assert.deepEqual(volume.readFileSync("/o.raw"), input);
  });
}
