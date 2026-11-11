import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

for (const format of ["gray16le", "gray16be"]) {
  for (const [width, height, frames] of [[1, 2, 1], [2, 2, 1], [2, 4, 2]] as const) {
    const stride = width * 2;
    const frameBytes = stride * height;
    const input = Buffer.from(Array.from({ length: frameBytes * frames }, (_, i) => (13 + i * 7) % 256));
    for (const filter of ["null", "separatefields", "setfield=tff,separatefields", "setfield=bff,separatefields"]) {
      it(`preserves ${format} samples and timing through ${filter} for ${frames} ${width}x${height} frames`, async () => {
        const volume = Volume.fromJSON({ "/in.raw": input });
        const stdout: Uint8Array[] = [];
        let stderr = "";
        const result = await createFfmpegCommand().execute({
          args: ["-hide_banner", "-loglevel", "info", "-f", "rawvideo", "-pix_fmt", format,
            "-s", `${width}x${height}`, "-r", "2", "-i", "/in.raw", "-vf", `${filter},showinfo`,
            "-fps_mode", "passthrough", "-pix_fmt", format, "-f", "rawvideo", "pipe:1"],
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
        const order = filter.startsWith("setfield=tff") ? [0, 1] : [1, 0];
        const expected = filter === "null" ? input : Buffer.concat(Array.from({ length: frames }, (_, frame) =>
          Buffer.concat(order.flatMap(parity => Array.from({ length: height / 2 }, (_, row) => {
            const start = frame * frameBytes + (row * 2 + parity) * stride;
            return input.subarray(start, start + stride);
          })))));
        assert.deepEqual(Buffer.concat(stdout), expected);
        const outputFrames = filter === "null" ? frames : frames * 2;
        const duration = filter === "null" ? 0.5 : 0.25;
        const info = stderr.split("\n").filter(line => line.startsWith("[showinfo] n:"));
        assert.equal(info.length, outputFrames, stderr);
        for (const [index, line] of info.entries()) {
          assert.ok(line.includes(`pts_time:${index * duration} `), line);
          assert.ok(line.includes(`duration_time:${duration} `), line);
          assert.ok(line.includes(` s:${width}x${filter === "null" ? height : height / 2} `), line);
        }
      });
    }
  }
}
