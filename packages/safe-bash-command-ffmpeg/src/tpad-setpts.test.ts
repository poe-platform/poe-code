import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Pixel bytes and framecrc timestamps verified against FFmpeg 7.0.2.
const pictures = [Buffer.from([10, 11]), Buffer.from([30, 31]), Buffer.from([60, 61]), Buffer.from([0, 0])];
const checksums = ["0x001f0015", "0x005b003d", "0x00b50079", "0x00000000"];
const clone = "tpad=start=1:stop=2:start_mode=clone:stop_mode=clone";
for (const graph of [false, true]) {
  for (const format of ["rawvideo", "framecrc"]) {
    for (const [filter, indices, timestamps, duration] of [
      [`null,${clone}`, [0, 0, 1, 2, 2, 2], [0, 1, 2, 3, 4, 5], .25],
      [`setpts=PTS+3,${clone}`, [0, 0, 1, 2, 2, 2], [0, 3, 4, 5, 6, 6], 0],
      [`setpts=PTS*2,${clone}`, [0, 0, 1, 2, 2, 2], [0, 0, 2, 4, 6, 6], 0],
      [`setpts=PTS*2,${clone},fps=4`, [0, 0, 1, 1, 2, 2], [0, 1, 2, 3, 4, 5], .25],
      ["setpts=PTS*2,tpad=start=2:start_mode=clone,fps=4", [0, 0, 1, 1, 2, 2], [0, 1, 2, 3, 4, 5], .25],
      ["setpts=PTS+3,tpad=start=2:stop=2", [3, 3, 0, 1, 2, 3, 3], [0, 0, 3, 4, 5, 6, 6], 0],
      ["setpts=PTS+3,tpad=stop=-1:stop_mode=clone,trim=end_frame=5", [0, 1, 2, 2, 2], [3, 4, 5, 6, 6], 0],
      ["setpts=PTS+3,tpad=start=2:stop=2:start_duration=1:stop_duration=1:start_mode=clone:stop_mode=clone", [0, 1, 2], [3, 4, 5], 0]
    ] as const) {
      it(`${graph ? "graph" : "simple"} ${format} preserves setpts timing through ${filter}`, async () => {
        const input = Buffer.concat(pictures.slice(0, 3));
        const volume = Volume.fromJSON({ "/in.raw": input });
        const output: Uint8Array[] = [];
        let stderr = "";
        const chain = `${filter},showinfo`;
        const result = await createFfmpegCommand().execute({
          args: ["-v", "info", "-f", "rawvideo", "-pixel_format", "gray", "-video_size", "2x1", "-framerate", "4", "-i", "/in.raw",
            ...(graph ? ["-filter_complex", `[0:v]${chain}[v]`, "-map", "[v]"] : ["-vf", chain]),
            "-fps_mode", "passthrough", "-pix_fmt", "gray", "-bitexact", "-f", format, "pipe:1"],
          cwd: "/", env: {}, signal: new AbortController().signal,
          fs: {
            async readFile(path: string) { return volume.readFileSync(path); },
            async stat(path: string) { return volume.statSync(path); }
          },
          stdin: (async function* () {})(),
          stdout: { async write(bytes: Uint8Array) { output.push(bytes); } },
          stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
        } as never);
        assert.equal(result.exitCode, 0, stderr);
        if (format === "rawvideo") {
          assert.deepEqual(Buffer.concat(output), Buffer.concat(indices.map(index => pictures[index]!)));
        } else {
          const text = Buffer.concat(output).toString();
          assert.ok(text.startsWith("#tb 0: 1/4\n"), text);
          assert.deepEqual(text.trim().split("\n").filter(line => !line.startsWith("#"))
            .map(line => line.split(",").map(field => field.trim())),
          indices.map((index, n) => ["0", String(timestamps[n]), String(timestamps[n]), "1", "2", checksums[index]]));
        }
        const rows = stderr.split("\n").filter(line => line.includes(" pts:"));
        assert.deepEqual(rows.map(row => Number(row.split(" ").find(token => token.startsWith("pts_time:"))?.slice(9))),
          timestamps.map(pts => pts / 4), stderr);
        assert.deepEqual(rows.map(row => Number(row.split(" ").find(token => token.startsWith("duration_time:"))?.slice(14))),
          indices.map(() => duration), stderr);
        assert.deepEqual(volume.readFileSync("/in.raw"), input);
      });
    }
  }
}
