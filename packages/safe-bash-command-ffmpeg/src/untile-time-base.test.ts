import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const input = Buffer.from(Array.from({ length: 24 }, (_, i) => (i * 53 + 39) % 256));
const pixels = "275cfb3091c6659acf04a3d8396e0d4277ac4b80e116b5ea";

for (const complex of [false, true]) {
  for (const [filter, timeBase, pts, times, hex] of [
    ["untile=2x1", "1/8", [0, 1, 2, 3, 4, 5], [0, 0.125, 0.25, 0.375, 0.5, 0.625], pixels],
    ["untile=2x1:", "1/8", [0, 1, 2, 3, 4, 5], [0, 0.125, 0.25, 0.375, 0.5, 0.625], pixels],
    ["untile=2x1,select='eq(pts,3)'", "1/8", [3], [0.375], "396e0d42"],
    ["settb=1/1000,untile=2x1", "1/1000", [0, 125, 250, 375, 500, 625], [0, 0.125, 0.25, 0.375, 0.5, 0.625], pixels],
    ["settb=1/6,untile=2x1", "1/24", [0, 3, 8, 11, 12, 15], [0, 0.125, 0.333333, 0.458333, 0.5, 0.625], pixels]
  ] as const) {
    it(`uses native untile PTS for ${filter} (complex=${complex})`, async () => {
      const volume = Volume.fromJSON({ "/in.raw": input });
      const stdout: Uint8Array[] = [], stderr: Uint8Array[] = [];
      const chain = `${filter},showinfo`;
      const result = await createFfmpegCommand().execute({
        args: ["-hide_banner", "-nostats", "-v", "info", "-f", "rawvideo", "-pixel_format", "gray",
          "-video_size", "4x2", "-framerate", "4", "-i", "/in.raw",
          ...(complex ? ["-filter_complex", `[0:v]${chain}[out]`, "-map", "[out]"] : ["-vf", chain]),
          "-fps_mode", "passthrough", "-pix_fmt", "gray", "-f", "rawvideo", "pipe:1"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(),
        stdout: { async write(bytes: Uint8Array) { stdout.push(bytes); } },
        stderr: { async write(bytes: Uint8Array) { stderr.push(bytes); } }
      } as never);
      const diagnostics = Buffer.concat(stderr).toString();
      assert.equal(result.exitCode, 0, diagnostics);
      assert.equal(Buffer.concat(stdout).toString("hex"), hex);
      assert.ok(diagnostics.includes(`config in time_base: ${timeBase}, frame_rate: 8/1`), diagnostics);
      const frames = diagnostics.split("\n").filter(line => line.startsWith("[showinfo] n:"));
      assert.deepEqual(frames.map(line => Number(line.split(" pts:")[1]!.split(" ")[0])), pts);
      assert.deepEqual(frames.map(line => Number(line.split(" pts_time:")[1]!.split(" ")[0])), times);
      assert.deepEqual(volume.readFileSync("/in.raw"), input);
    });
  }
}
