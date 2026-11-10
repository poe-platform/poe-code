import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// FFmpeg 7.0.2 accepts 32-bit flags before checking the negotiated components.
// Unavailable components fail after opening the raw output, even with high bits.
for (const [components, expected] of [
  ["128", null],
  ["255", null],
  ["64", null],
  ["2147483648", null],
  ["4294967295", null],
  ["r", "ef2030bf50608f80905fb0c0"],
  ["128-128+r", "ef2030bf50608f80905fb0c0"]
] as const) {
  for (const existingOutput of [false, true]) {
    it(`matches native negate mask ${components} with ${existingOutput ? "existing" : "absent"} output`, async () => {
      const input = Buffer.from("102030405060708090a0b0c0", "hex");
      const volume = Volume.fromJSON({ "/in.raw": input });
      if (existingOutput) volume.writeFileSync("/out.raw", "KEEP");
      const errors: Uint8Array[] = [];
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-y", "-f", "rawvideo", "-pixel_format", "rgb24",
          "-video_size", "2x1", "-framerate", "2", "-i", "/in.raw",
          "-vf", `negate=components=${components}`, "-pix_fmt", "rgb24", "-f", "rawvideo", "/out.raw"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(), stdout: { async write() {} },
        stderr: { async write(bytes: Uint8Array) { errors.push(bytes); } }
      } as never);
      const stderr = Buffer.concat(errors).toString();
      assert.equal(result.exitCode, expected === null ? 234 : 0, stderr);
      assert.equal(stderr, expected === null ? "ffmpeg: negate: Requested components not available\n" : "");
      assert.equal((volume.readFileSync("/out.raw") as Buffer).toString("hex"), expected ?? "");
      assert.deepEqual(volume.readFileSync("/in.raw"), input);
    });
  }
}
