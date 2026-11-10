import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

for (const [options, width] of [
  ["w=2:2:1:1", 2],
  ["h=2:2:1:1", 4],
  ["out_w=2:2:1:1", 2],
  ["out_h=2:2:1:1", 4],
  ["2:2:1:1", 2],
  ["iw:2:1:1", 4],
  ["2:h=2:1:1", 2],
  ["2:2:x=1:1:0:1", 2],
] as const) {
  it(`binds crop fields by position for ${options}`, async () => {
    const input = Buffer.from(Array.from({ length: 48 }, (_, i) => [16 + i, 32 + i, 64 + i, 128 + i]).flat());
    const volume = Volume.fromJSON({ "/in.raw": input, "/out.raw": "KEEP" });
    const errors: Uint8Array[] = [];
    const result = await createFfmpegCommand().execute({
      args: ["-v", "error", "-y", "-f", "rawvideo", "-pixel_format", "rgba",
        "-video_size", "4x4", "-framerate", "4", "-i", "/in.raw",
        "-vf", `crop=${options}`, "-fps_mode", "passthrough", "-pix_fmt", "rgba",
        "-f", "rawvideo", "/out.raw"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async stat(path: string) { return volume.statSync(path); },
        async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); }
      },
      stdin: (async function* () {})(), stdout: { async write() {} },
      stderr: { async write(bytes: Uint8Array) { errors.push(bytes); } }
    } as never);
    assert.equal(result.exitCode, 0, Buffer.concat(errors).toString());
    const expected = Buffer.concat(Array.from({ length: 6 }, (_, row) => {
      const offset = (Math.floor(row / 2) * 16 + (row % 2 + 1) * 4 + (width === 2 ? 1 : 0)) * 4;
      return input.subarray(offset, offset + width * 4);
    }));
    assert.deepEqual(volume.readFileSync("/out.raw"), expected);
  });
}
