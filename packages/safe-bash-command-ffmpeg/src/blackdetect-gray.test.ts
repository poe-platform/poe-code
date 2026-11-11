import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

for (const pixelFormat of ["gray", "gray8"]) {
  for (const threshold of [0, 0.01]) {
    it(`matches native blackdetect intervals for ${pixelFormat} at pix_th=${threshold}`, async () => {
      const input = Buffer.from([0, 0, 0, 0, 255, 255, 0, 255, 1, 1, 0, 0, 220, 220, 0, 0]);
      const volume = Volume.fromJSON({ "/in.raw": input });
      const output: Uint8Array[] = [];
      const errors: Uint8Array[] = [];
      const result = await createFfmpegCommand().execute({
        args: ["-hide_banner", "-nostats", "-v", "info", "-f", "rawvideo", "-pixel_format", pixelFormat,
          "-video_size", "2x1", "-framerate", "4", "-i", "in.raw", "-vf", `blackdetect=d=0:pix_th=${threshold}`,
          "-fps_mode", "passthrough", "-pix_fmt", "gray", "-f", "rawvideo", "pipe:1"],
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
      const error = Buffer.concat(errors).toString();
      assert.equal(result.exitCode, 0, error);
      assert.deepEqual(Buffer.concat(output), input);
      assert.deepEqual(error.trimEnd().split("\n"), [
        "black_start:0 black_end:0.5 black_duration:0.5",
        threshold === 0 ? "black_start:1.25 black_end:1.5 black_duration:0.25"
          : "black_start:1 black_end:1.5 black_duration:0.5",
        "black_start:1.75 black_end:1.75 black_duration:0"
      ]);
    });
  }
}
