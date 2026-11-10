import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import type { MediaResourceLimits } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

const values = [32, 52, 72, 92, 112, 132];
const pixels = (frames: readonly number[]) => Buffer.concat(frames.map(value =>
  Buffer.concat([Buffer.alloc(4, value), Buffer.alloc(8, 128)])));
const input = Buffer.concat([Buffer.from("YUV4MPEG2 W2 H2 F4:1 Ip A1:1 C444\n"),
  ...values.map(value => Buffer.concat([Buffer.from("FRAME\n"), pixels([value])]))]);
const eight = [32, 52, 72, 92, 72, 92, 72, 92];

for (const graph of [false, true]) {
  for (const [filter, options, expected, limits] of [
    ["loop=-1:2:3", ["-frames:v", "8"], eight],
    ["loop=loop=-1:size=2:start=3", ["-t", "2"], eight],
    ["loop=-1:2:3,trim=end_frame=8", [], eight],
    ["loop=-1:2:3,trim=end=2", [], eight],
    ["loop=-1:2:3,select='not(mod(n,2))'", ["-frames:v", "5"], [32, 72, 72, 72, 72]],
    ["loop=8:2:3", ["-frames:v", "8"], eight],
    ["loop=8:2:3,select='not(mod(n,2))'", ["-frames:v", "5"], [32, 72, 72, 72, 72]],
    ["loop=-1:2:3,select='not(mod(n,2))',trim=end_frame=5", [], [32, 72, 72, 72, 72]],
    ["loop=-1:2:3,trim=end_frame=8,select=0", [], []],
    ["loop=-1:2:3,trim=end_frame=0", [], []],
    ["loop=-1:2:3,trim=end=0", [], []],
    ["loop=-1:2:3", ["-frames:v", "0"], []],
    ["loop=-1:2:3", ["-t", "0"], []],
    ["loop=-1:2:3", ["-ss", "1", "-t", "1"], [72, 92, 72, 92]],
    ["loop=-1:2:3", ["-to", "2"], eight],
    ["loop=-1:0:3", [], values],
    ["loop=-1:2:9", [], values],
    ["loop=-1:2:3,trim=start_frame=3:end_frame=7", [], [92, 72, 92, 72]],
    ["loop=-1:2:3", ["-frames:v", "8"], eight, { maxSamplesPerTrack: 8 }],
    ["loop=-1:2:3", ["-frames:v", "8"], null, { maxSamplesPerTrack: 7 }],
    ["loop=-1:2:3,select=not(mod(n\\,100))", ["-frames:v", "2"], null, { maxSamplesPerTrack: 12 }],
    ["loop=-1:2:3", ["-frames:v", "8"], null, { maxDurationSeconds: 1.5 }],
    ["loop=-1:2:3", [], null],
    ["loop=-1:2:3,trim=start_frame=2", [], null]
  ] as readonly (readonly [string, readonly string[], readonly number[] | null, MediaResourceLimits?])[]) {
    it(`infinite video loop ${graph ? "graph" : "simple"}: ${filter} ${options.join(" ")}`, async () => {
      const volume = Volume.fromJSON({ "/in.y4m": input, "/o.raw": "KEEP" });
      let stderr = "";
      const result = await createFfmpegCommand({ limits }).execute({
        args: ["-v", "error", "-y", "-i", "/in.y4m",
          ...(graph ? ["-filter_complex", `[0:v]${filter}[out]`, "-map", "[out]"] : ["-vf", filter]),
          ...options, "-fps_mode", "passthrough", "-pix_fmt", "yuv444p", "-f", "rawvideo", "/o.raw"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(), stdout: { async write() {} },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      if (expected === null) {
        assert.notEqual(result.exitCode, 0, stderr);
        assert.ok(stderr.includes(limits ? Object.keys(limits)[0]! : "loop:"), stderr);
        assert.equal(volume.readFileSync("/o.raw", "utf8"), "KEEP");
      } else {
        assert.equal(result.exitCode, 0, stderr);
        assert.deepEqual(volume.readFileSync("/o.raw"), pixels(expected));
      }
      assert.deepEqual(volume.readFileSync("/in.y4m"), input);
    });
  }
}
