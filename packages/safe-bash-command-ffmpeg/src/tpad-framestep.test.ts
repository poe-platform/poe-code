import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg: padding uses the filtered rate, while retained frames keep their durations.
for (const graph of [false, true]) {
  for (const [filter, ids, times, durations] of [
    ["tpad=stop_duration=1:stop_mode=clone", [1, 2, 3, 4, 4, 4, 4, 4], [0, .25, .5, .75, 1, 1.25, 1.5, 1.75], Array(8).fill(.25)],
    ["framestep=2,tpad=stop_duration=1:stop_mode=clone", [1, 3, 3, 3], [0, .5, 1, 1.5], [.25, .25, .5, .5]],
    ["framestep=2,tpad=stop=2:stop_mode=clone", [1, 3, 3, 3], [0, .5, 1, 1.5], [.25, .25, .5, .5]],
    ["framestep=2,tpad=stop=2:stop_mode=clone,trim=start=1.25", [3], [1.5], [.5]],
    ["framestep=2,tpad=start=2:start_mode=clone", [1, 1, 1, 3], [0, .5, 1, 1.5], [.5, .5, .25, .25]],
    ["framestep=2,tpad=start_duration=1:start_mode=clone", [1, 1, 1, 3], [0, .5, 1, 1.5], [.5, .5, .25, .25]],
    ["framestep=2,tpad=stop=2", [1, 3, 0, 0], [0, .5, 1, 1.5], [.25, .25, .5, .5]],
    ["trim=end_frame=3,framestep=2,tpad=stop=2:stop_mode=clone", [1, 3, 3, 3], [0, .5, .75, 1.25], [.25, .25, .5, .5]],
    ["framestep=2,tpad=stop=-1:stop_mode=clone,trim=end_frame=4", [1, 3, 3, 3], [0, .5, 1, 1.5], [.25, .25, .5, .5]]
  ] as const) {
    it(`${graph ? "graph" : "simple"} ${filter} preserves padding timing`, async () => {
      const input = Buffer.concat([1, 2, 3, 4].map(id => Buffer.alloc(4, id)));
      const volume = Volume.fromJSON({ "/in.raw": input });
      const output: Uint8Array[] = [];
      let stderr = "";
      const chain = `${filter},showinfo`;
      const result = await createFfmpegCommand().execute({
        args: ["-v", "info", "-f", "rawvideo", "-framerate", "4", "-pixel_format", "gray", "-video_size", "2x2", "-i", "/in.raw",
          ...(graph ? ["-filter_complex", `[0:v]${chain}[v]`, "-map", "[v]"] : ["-vf", chain]),
          "-fps_mode", "passthrough", "-pix_fmt", "gray", "-f", "rawvideo", "pipe:1"],
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
      assert.deepEqual(Buffer.concat(output), Buffer.concat(ids.map(id => Buffer.alloc(4, id))));
      const rows = stderr.split("\n").filter(line => line.includes(" pts:"));
      for (const [key, expected] of [["pts_time:", times], ["duration_time:", durations]] as const) {
        assert.deepEqual(rows.map(row => Number(row.split(" ").find(token => token.startsWith(key))?.slice(key.length))), expected, stderr);
      }
      assert.deepEqual(volume.readFileSync("/in.raw"), input);
    });
  }
}
