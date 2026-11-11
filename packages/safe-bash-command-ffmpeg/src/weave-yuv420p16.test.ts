import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Complete raw output from native FFmpeg 7.0.2 for three 2x2 fields at 4 fps.
const input420 = "11589fe62d74bb024990d71e65acf33a81c80f569de42b72b900478ed51c63aaf1387fc6";
for (const [format, filter, input, expected] of [
  ["yuv420p16le", "weave=top", input420,
    "11589fe665acf33a2d74bb0281c80f5649909de4d71e2b72"],
  ["yuv420p16le", "doubleweave=bottom", input420,
    "65acf33a11589fe681c80f562d74bb029de449902b72d71e65acf33ab900478e81c80f56d51c63aa9de4f1382b727fc6"],
  ["yuv420p16le", "null", input420, input420],
  ["yuv444p16le", "weave=top",
    `${input420}0d549be22970b7fe458cd31a61a8ef367dc40b5299e0276eb5fc438ad1185fa6ed347bc2`,
    "11589fe6b900478e2d74bb02d51c63aa4990d71ef1387fc665acf33a0d549be281c80f562970b7fe9de42b72458cd31a"]
] as const) {
  it(`preserves native ${format} rows through ${filter}`, async () => {
    const volume = Volume.fromJSON({ "/in.raw": Buffer.from(input, "hex") });
    const stdout: Uint8Array[] = [];
    const errors: Uint8Array[] = [];
    const result = await createFfmpegCommand().execute({
      args: ["-hide_banner", "-nostats", "-v", "error", "-f", "rawvideo",
        "-pixel_format", format, "-video_size", "2x2", "-framerate", "4", "-i", "/in.raw",
        "-vf", filter, "-fps_mode", "passthrough", "-pix_fmt", format, "-f", "rawvideo", "pipe:1"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async stat(path: string) { return volume.statSync(path); }
      },
      stdin: (async function* () {})(),
      stdout: { async write(bytes: Uint8Array) { stdout.push(bytes); } },
      stderr: { async write(bytes: Uint8Array) { errors.push(bytes); } }
    } as never);
    const stderr = Buffer.concat(errors).toString();
    assert.equal(result.exitCode, 0, stderr);
    assert.equal(stderr, "");
    assert.equal(Buffer.concat(stdout).toString("hex"), expected);
    assert.equal((volume.readFileSync("/in.raw") as Buffer).toString("hex"), input);
  });
}
