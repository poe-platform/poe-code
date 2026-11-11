import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

for (const format of ["rgb48le", "rgba64le", "rgb48be", "rgba64be"]) {
  const stride = 2 * (format.startsWith("rgba") ? 8 : 6);
  for (const frames of [1, 2]) {
    // FFmpeg 7.0.2 fixtures: one or two 2x4 frames at 4 fps.
    const input = Buffer.from(Array.from({ length: stride * 4 * frames }, (_, i) => (17 + i * 71) % 256));
    for (const filter of ["null", "separatefields", "setfield=tff,separatefields", "setfield=bff,separatefields"]) {
      for (const complex of [false, true]) {
        it(`preserves ${format} samples and timing through ${filter} (${frames} frames, complex=${complex})`, async () => {
          const volume = Volume.fromJSON({ "/in.raw": input });
          const stdout: Uint8Array[] = [];
          let stderr = "";
          const result = await createFfmpegCommand().execute({
            args: ["-hide_banner", "-nostats", "-v", "info", "-f", "rawvideo", "-pixel_format", format,
              "-video_size", "2x4", "-framerate", "4", "-i", "/in.raw",
              ...(complex ? ["-filter_complex", `[0:v]${filter},showinfo[out]`, "-map", "[out]"]
                : ["-vf", `${filter},showinfo`]),
              "-fps_mode", "passthrough", "-pix_fmt", format, "-f", "rawvideo", "pipe:1"],
            cwd: "/", env: {}, signal: new AbortController().signal,
            fs: {
              async readFile(path: string) { return volume.readFileSync(path); },
              async stat(path: string) { return volume.statSync(path); }
            },
            stdin: (async function* () {})(),
            stdout: { async write(bytes: Uint8Array) { stdout.push(bytes); } },
            stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
          } as never);
          assert.equal(result.exitCode, 0, stderr);
          const rows = filter.startsWith("setfield=tff") ? [0, 2, 1, 3] : [1, 3, 0, 2];
          const expected = filter === "null" ? input : Buffer.concat(Array.from({ length: frames }, (_, frame) =>
            Buffer.concat(rows.map(row => input.subarray((frame * 4 + row) * stride, (frame * 4 + row + 1) * stride)))));
          assert.deepEqual(Buffer.concat(stdout), expected);
          assert.deepEqual(volume.readFileSync("/in.raw"), input);
          const duration = filter === "null" ? 0.25 : 0.125;
          const info = stderr.split("\n").filter(line => line.startsWith("[showinfo] n:"));
          assert.equal(info.length, frames * (filter === "null" ? 1 : 2), stderr);
          for (const [index, line] of info.entries()) {
            assert.ok(line.includes(`n:${index} pts:${index} pts_time:${index * duration} `), line);
            assert.ok(line.includes(`duration:1 duration_time:${duration} `), line);
            assert.ok(line.includes(` s:2x${filter === "null" ? 4 : 2} `), line);
          }
        });
      }
    }
  }
}
