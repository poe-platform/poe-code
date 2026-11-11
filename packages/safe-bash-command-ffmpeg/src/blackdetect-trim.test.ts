import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const input = Buffer.from([0, 0, 0, 0, 255, 255, 0, 255, 1, 1, 0, 0, 220, 220, 0, 0]);
const intervals = [
  "black_start:0 black_end:0.5 black_duration:0.5",
  "black_start:1 black_end:1.5 black_duration:0.5",
  "black_start:1.75 black_end:1.75 black_duration:0"
];

for (const [suffix, expected, reports] of [
  ["", input, intervals],
  [",trim=end_frame=2", input.subarray(0, 4), intervals.slice(0, 1)],
  [",trim=end_frame=1", input.subarray(0, 2), ["black_start:0 black_end:0.25 black_duration:0.25"]],
  [",trim=end_frame=0", input.subarray(0, 0), ["black_start:0 black_end:0 black_duration:0"]],
  [",trim=end=0.5", input.subarray(0, 4), intervals.slice(0, 1)],
  [",null,trim=end_frame=2", input.subarray(0, 4), intervals.slice(0, 1)],
  [",select=1,trim=end_frame=2", input.subarray(0, 4), intervals.slice(0, 1)]
] as const) {
  it(`blackdetect reports only consumed intervals with ${suffix || "no trim"}`, async () => {
    const volume = Volume.fromJSON({ "/in.raw": input });
    const stdout: Uint8Array[] = [], stderr: Uint8Array[] = [];
    const result = await createFfmpegCommand().execute({
      args: ["-hide_banner", "-nostats", "-v", "info", "-f", "rawvideo", "-pixel_format", "gray",
        "-video_size", "2x1", "-framerate", "4", "-i", "in.raw", "-vf", `blackdetect=d=0:pix_th=0.01${suffix}`,
        "-fps_mode", "passthrough", "-pix_fmt", "gray", "-f", "rawvideo", "pipe:1"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
        async stat(path: string) { return volume.statSync(path); }
      },
      stdin: (async function* () {})(),
      stdout: { async write(bytes: Uint8Array) { stdout.push(bytes); } },
      stderr: { async write(bytes: Uint8Array) { stderr.push(bytes); } }
    } as never);
    const error = Buffer.concat(stderr).toString();
    assert.equal(result.exitCode, 0, error);
    assert.deepEqual(Buffer.concat(stdout), expected);
    assert.deepEqual(error.trim().split("\n"), reports);
  });
}
