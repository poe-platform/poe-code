import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const frames = [[50, 30, 212], [120, 180, 60], [80, 140, 190], [81, 90, 240], [16, 128, 128]]
  .map(planes => Buffer.concat(planes.map(value => Buffer.alloc(4, value))));
const input = Buffer.concat([Buffer.from("YUV4MPEG2 W2 H2 F4:1 Ip A1:1 C444\n"),
  ...frames.slice(0, 3).flatMap(frame => [Buffer.from("FRAME\n"), frame])]);

for (const graph of [false, true]) {
  for (const [filter, options, indices] of [
    ["null", [], [0, 1, 2]],
    ["tpad", [], [0, 1, 2]],
    ...["0", "add", "default", "min", "0.25", "0.5", "clone-add-1"].map(mode =>
      [`tpad=start=1:stop=1:start_mode=${mode}:stop_mode=${mode}`, [], [4, 0, 1, 2, 4]] as const),
    ...["1", "clone", "max", "0.75", "add+clone", "1/2+0.25", "PI-PI+1", "E-E+1", "PHI-PHI+1"].map(mode =>
      [`tpad=start=1:stop=1:start_mode=${mode}:stop_mode=${mode}`, [], [0, 0, 1, 2, 2]] as const),
    ...["start_mode", "stop_mode"].flatMap(key =>
      ["-0.01", "1.01", "2", "NaN", "1/0", "unknown"].map(mode =>
        [`tpad=${key}=${mode}`, [], null] as const)),
    ["select=0,tpad=start=1:stop=2:color=red", [], [3, 3, 3]],
    ["select=0,tpad=stop=2", [], [4, 4]],
    ["select=0,tpad=stop=2:stop_mode=clone", [], []],
    ["select=0,tpad=start=2:start_mode=clone:stop=1", [], []],
    ["select=0,tpad=start=1:stop=2:stop_mode=clone", [], [4]],
    ["select=0,tpad=stop_duration=500ms", [], [4, 4]],
    ["select=0,tpad=stop=-1,trim=end_frame=2", [], [4, 4]],
    ["select=0,tpad", [], []],
    ["select=0,tpad=start=2147483647", [], null],
    ["tpad=start_mode=clone:start=1", [], [0, 0, 1, 2]],
    ["tpad=stop_mode=clone:stop_duration=500ms", [], [0, 1, 2, 2, 2]],
    ["tpad=start=1:stop=1", [], [4, 0, 1, 2, 4]],
    ["tpad=start=1:stop=1:threads=1", [], [4, 0, 1, 2, 4]],
    ["tpad=start=1:stop=1:thread_type=slice", [], [4, 0, 1, 2, 4]],
    ["tpad=start=1:stop=1:extra_hw_frames=1", [], [4, 0, 1, 2, 4]],
    ["tpad=start=1:stop=1:threads=0:thread_type=none:extra_hw_frames=-1", [], [4, 0, 1, 2, 4]],
    ["tpad=start=1:stop=1:threads=max:thread_type=all-slice:extra_hw_frames=default", [], [4, 0, 1, 2, 4]],
    ["tpad=start=1:stop=1:threads=1+1:thread_type=+slice:extra_hw_frames=max", [], [4, 0, 1, 2, 4]],
    ["tpad=start=1:stop=1:color=red", [], [3, 0, 1, 2, 3]],
    ["tpad=start_mode=clone:start=1,select='eq(t,0.5)'", [], [1]],
    ["tpad=stop=-1:stop_mode=clone", ["-frames:v", "5"], [0, 1, 2, 2, 2]],
    ["tpad=stop=-1:stop_mode=clone", ["-t", "1.25"], [0, 1, 2, 2, 2]],
    ["tpad=stop=-1:stop_mode=clone,trim=end_frame=5", [], [0, 1, 2, 2, 2]],
    ["tpad=stop=-1:stop_mode=clone,select='not(mod(n,2))'", ["-frames:v", "3"], [0, 2, 2]],
    ["tpad=start_duration=125ms:start_mode=clone", [], [0, 0, 1, 2]],
    ["tpad=1:1:clone:clone", [], [0, 0, 1, 2, 2]],
    ["tpad=start=9:start_duration=250ms:start_mode=clone", [], [0, 0, 1, 2]],
    ["tpad=stop=-1:stop_duration=500ms:stop_mode=clone", [], [0, 1, 2, 2, 2]],
    ["tpad=stop=-1", [], null],
    ["tpad=start=-1", [], null],
    ["tpad=stop=-2", [], null],
    ["tpad=start_mode=invalid", [], null],
    ["tpad=start_duration=-1", [], null],
    ["tpad=unknown=1", [], null],
    ["tpad=start=1:threads=-1", [], null],
    ["tpad=start=1:threads=2147483648", [], null],
    ["tpad=start=1:threads=invalid", [], null],
    ["tpad=start=1:thread_type=frame", [], null],
    ["tpad=start=1:thread_type=0.5", [], null],
    ["tpad=start=1:thread_type=4294967296", [], null],
    ["tpad=start=1:extra_hw_frames=-2", [], null],
    ["tpad=start=1:extra_hw_frames=2147483648", [], null],
    ["tpad=start=1:extra_hw_frames=invalid", [], null],
    ["tpad=start=2147483647", [], null]
  ] as const) {
    it(`${graph ? "graph" : "simple"} ${filter} ${options.join(" ")}`, async () => {
      const volume = Volume.fromJSON({ "/in.y4m": input, "/o.raw": "KEEP" });
      let stderr = "";
      const result = await createFfmpegCommand({ limits: { maxSamplesPerTrack: 100, maxMemoryBytes: 1000000 } }).execute({
        args: ["-v", "error", "-y", "-i", "/in.y4m",
          ...(graph ? ["-filter_complex", `[0:v]${filter}[out]`, "-map", "[out]"] : ["-vf", filter]),
          ...options, "-fps_mode", "passthrough", "-pix_fmt", "yuv444p", "-f", "rawvideo", "/o.raw"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, data: Uint8Array) { volume.writeFileSync(path, data); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(), stdout: { async write() {} },
        stderr: { async write(data: Uint8Array) { stderr += new TextDecoder().decode(data); } }
      } as never);
      if (indices) {
        assert.equal(result.exitCode, 0, stderr);
        assert.deepEqual(volume.readFileSync("/o.raw"), Buffer.concat(indices.map(index => frames[index]!)));
      } else {
        assert.notEqual(result.exitCode, 0, stderr);
        assert.equal(volume.readFileSync("/o.raw", "utf8"), "KEEP");
      }
      assert.deepEqual(volume.readFileSync("/in.y4m"), input);
    });
  }
}
