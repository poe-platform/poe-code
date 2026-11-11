import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2, seven 2x2 gray sheets at 6 fps, passthrough timestamps.
for (const graph of [false, true] as const) {
  for (const [filter, hex] of [
    ["setpts=PTS+2,untile=2x1,fps=6", "1111212131314141515161617171"],
    ["setpts=2*PTS,untile=2x1,fps=6", "11111111212121213131313141414141515151516161616171717171"],
    ["untile=2x1,fps=6", "1010202030304040505060607070"],
    ["setpts=PTS+2,untile=2x1", "10101111202021213030313140404141505051516060616170707171"]
  ] as const) {
    it(`selects native cells and final frame count for ${filter} (graph=${graph})`, async () => {
      const input = Buffer.from(Array.from({ length: 7 }, (_, i) =>
        [0, 1, 0, 1].map(column => (i + 1) * 16 + column)).flat());
      const volume = Volume.fromJSON({ "/in.gray": input });
      const stdout: Uint8Array[] = [];
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-v", "fatal", "-f", "rawvideo", "-pixel_format", "gray", "-video_size", "2x2",
          "-framerate", "6", "-i", "/in.gray",
          ...(graph ? ["-filter_complex", `[0:v]${filter}[out]`, "-map", "[out]"] : ["-vf", filter]),
          "-fps_mode", "passthrough",
          "-pix_fmt", "gray", "-f", "rawvideo", "pipe:1"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(),
        stdout: { async write(bytes: Uint8Array) { stdout.push(bytes.slice()); } },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      assert.equal(result.exitCode, 0, stderr);
      assert.equal(Buffer.concat(stdout).toString("hex"), hex);
      assert.deepEqual(volume.readFileSync("/in.gray"), input);
    });
  }
}
