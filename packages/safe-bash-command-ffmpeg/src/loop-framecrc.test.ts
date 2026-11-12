import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Complete packets from native FFmpeg 7.0.2, including repeated timestamps.
for (const graph of [false, true]) {
  for (const [filter, timestamps, pictures] of [
    ["setpts=PTS,loop=loop=1:size=3:start=1", [0, 1, 2, 2, 2, 2, 3, 4, 5, 6], [1, 2, 3, 1, 2, 3, 4, 5, 6, 7]],
    ["setpts=PTS+2,loop=loop=1:size=3:start=1", [2, 3, 4, 4, 4, 4, 5, 6, 7, 8], [1, 2, 3, 1, 2, 3, 4, 5, 6, 7]],
    ["loop=loop=1:size=3:start=1", [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], [1, 2, 3, 1, 2, 3, 4, 5, 6, 7]],
    ["setpts=PTS+2", [2, 3, 4, 5, 6, 7, 8], [1, 2, 3, 4, 5, 6, 7]]
  ] as const) {
    it(`${graph ? "graph" : "simple"} ${filter} keeps framecrc packets in playback order`, async () => {
      const input = Buffer.from([1, 2, 3, 4, 5, 6, 7]);
      const volume = Volume.fromJSON({ "/in.raw": input });
      let stdout = "";
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-hide_banner", "-loglevel", "error", "-f", "rawvideo", "-pixel_format", "gray",
          "-video_size", "1x1", "-framerate", "4", "-i", "/in.raw",
          ...(graph ? ["-filter_complex", `[0:v]${filter}[out]`, "-map", "[out]"] : ["-vf", filter]),
          "-fps_mode", "passthrough", "-pix_fmt", "gray", "-f", "framecrc", "pipe:1"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(),
        stdout: { async write(bytes: Uint8Array) { stdout += new TextDecoder().decode(bytes); } },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      assert.equal(result.exitCode, 0, stderr);
      assert.equal(stderr, "");
      const lines = stdout.trim().split("\n");
      assert.ok(lines.includes("#tb 0: 1/4"));
      assert.deepEqual(lines.filter(line => !line.startsWith("#")).map(line => line.split(",").map(value => value.trim())),
        timestamps.map((timestamp, index) => ["0", String(timestamp), String(timestamp), "1", "1",
          `0x${(pictures[index]! * 65537).toString(16).padStart(8, "0")}`]));
      assert.deepEqual(volume.readFileSync("/in.raw"), input);
    });
  }
}
