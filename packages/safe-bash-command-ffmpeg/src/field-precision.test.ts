import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

for (const format of ["rgb48be", "rgba64be", "rgb24"] as const) {
  const pixelBytes = format === "rgb48be" ? 6 : format === "rgba64be" ? 8 : 3;
  for (const [width, height, frames] of [[1, 2, 1], [2, 4, 2]] as const) {
    const stride = width * pixelBytes;
    const frameBytes = stride * height;
    const input = Buffer.from(Array.from({ length: frameBytes * frames }, (_, i) => (13 + i * 7) % 256));
    for (const field of ["null", "top", "bottom"] as const) {
      it(`preserves exact ${format} bytes for ${field} in ${frames} ${width}x${height} frames`, async () => {
        const volume = Volume.fromJSON({ "/in.raw": input });
        const stdout: Uint8Array[] = [];
        let stderr = "";
        const result = await createFfmpegCommand().execute({
          args: ["-hide_banner", "-loglevel", "info", "-f", "rawvideo", "-pix_fmt", format,
            "-s", `${width}x${height}`, "-i", "/in.raw", "-vf",
            `${field === "null" ? "null" : `field=${field}`},showinfo`,
            "-pix_fmt", format, "-f", "rawvideo", "pipe:1"],
          cwd: "/", env: {}, signal: new AbortController().signal,
          fs: {
            async readFile(path: string) { return volume.readFileSync(path); },
            async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
            async stat(path: string) { return volume.statSync(path); }
          },
          stdin: (async function* () {})(),
          stdout: { async write(bytes: Uint8Array) { stdout.push(bytes); } },
          stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
        } as never);
        assert.equal(result.exitCode, 0, stderr);
        const expected = field === "null" ? input : Buffer.concat(Array.from({ length: frames }, (_, frame) =>
          Buffer.concat(Array.from({ length: height / 2 }, (_, row) => {
            const start = frame * frameBytes + (row * 2 + (field === "bottom" ? 1 : 0)) * stride;
            return input.subarray(start, start + stride);
          }))));
        assert.deepEqual(Buffer.concat(stdout), expected);
        assert.ok(stderr.includes(`s:${width}x${field === "null" ? height : height / 2}`), stderr);
      });
    }
  }
}
