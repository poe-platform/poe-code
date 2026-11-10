import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Frame repetitions verified against native FFmpeg 7.0.2, including EOF flushing.
for (const [filter, options, repetitions, rate = 2] of [
  ["null", [], [1, 1, 1]],
  ["setpts=PTS", [], [12, 12, 12]],
  ["setpts=PTS", [], [24, 25, 24], 1],
  ["setpts=PTS", [], [4, 5, 4], 5],
  ["setpts=PTS", [], [1, 1, 1], 25],
  ["setpts=2*PTS", ["-fps_mode", "cfr"], [24, 25, 24]],
  ["setpts=2*PTS", [], [24, 25, 24]],
  ["setpts=PTS/2", [], [1, 11, 1]],
  ["setpts=PTS,null", [], [12, 12, 12]],
  ["setpts=PTS,fps=2", [], [1, 1, 1]],
  ["setpts=2*PTS", ["-fps_mode", "passthrough"], [1, 1, 1]],
  ["setpts=2*PTS", ["-vsync", "0"], [1, 1, 1]],
  ["setpts=2*PTS", ["-frames:v", "5"], [5, 0, 0]],
  ["setpts=PTS", ["-frames:v", "0"], [0, 0, 0]]
] as const) {
  it(`rawvideo synchronizes ${filter} at ${rate} fps ${options.join(" ")}`, async () => {
    const source = Buffer.from(Array.from({ length: 36 }, (_, index) => index));
    const volume = Volume.fromJSON({ "/in.raw": source });
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-v", "error", "-f", "rawvideo", "-pixel_format", "gray",
        "-video_size", "4x3", "-framerate", String(rate), "-i", "/in.raw",
        "-vf", filter, ...options, "-pix_fmt", "gray", "-f", "rawvideo", "/out.raw"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
        async stat(path: string) { return volume.statSync(path); }
      },
      stdin: (async function* () {})(), stdout: { async write() {} },
      stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
    } as never);
    assert.equal(result.exitCode, 0, stderr);
    assert.equal(stderr, "");
    assert.deepEqual(volume.readFileSync("/out.raw"), Buffer.concat(repetitions.flatMap((count, index) =>
      Array.from({ length: count }, () => source.subarray(index * 12, (index + 1) * 12)))));
    assert.deepEqual(volume.readFileSync("/in.raw"), source);
  });
}

it("bounds rawvideo timestamp duplication before writing output", async () => {
  const volume = Volume.fromJSON({ "/in.raw": Buffer.from([10, 20, 30]), "/out.raw": "KEEP" });
  let stderr = "";
  const result = await createFfmpegCommand({ limits: { maxFrames: 10 } }).execute({
    args: ["-v", "error", "-y", "-f", "rawvideo", "-pixel_format", "gray",
      "-video_size", "1x1", "-framerate", "2", "-i", "/in.raw",
      "-vf", "setpts=1000000*PTS", "-pix_fmt", "gray", "-f", "rawvideo", "/out.raw"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile() { assert.fail("must not write unbounded output"); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(), stdout: { async write() {} },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  assert.equal(result.exitCode, 1, stderr);
  assert.match(stderr, /maxFrames/);
  assert.equal(volume.readFileSync("/out.raw", "utf8"), "KEEP");
});
