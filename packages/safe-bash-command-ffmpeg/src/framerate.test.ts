import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import type { MediaResourceLimits } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

const source = [10, 30, 60, 100, 150, 210];
async function run(filter: string, pixels = source, width = 1, height = 1, graph = false, extra: string[] = [], limits?: MediaResourceLimits) {
  const volume = Volume.fromJSON({
    "/in.gray": Buffer.from(pixels.flatMap(value => Array<number>(width * height).fill(value))),
    "/out.gray": "KEEP"
  });
  let stderr = "";
  const result = await createFfmpegCommand({ limits }).execute({
    args: ["-v", "info", "-y", "-f", "rawvideo", "-pix_fmt", "gray", "-s", `${width}x${height}`, "-r", "4", "-i", "/in.gray",
      ...(graph ? ["-filter_complex", `[0:v]${filter}[out]`, "-map", "[out]"] : ["-vf", filter]),
      "-fps_mode", "passthrough", "-pix_fmt", "gray", "-bitexact", ...extra, "-f", "rawvideo", "/out.gray"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, data: Uint8Array) { volume.writeFileSync(path, data); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(), stdout: { async write() {} },
    stderr: { async write(data: Uint8Array) { stderr += new TextDecoder().decode(data); } }
  } as never);
  return { ...result, stderr, bytes: volume.readFileSync("/out.gray") };
}

for (const graph of [false, true]) {
  it(`interpolates grayscale frames at 5 fps (graph=${graph})`, async () => {
    const result = await run("framerate=fps=5", source, 1, 1, graph);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.deepEqual(result.bytes, Buffer.from([10, 30, 48, 76, 110, 150, 198, 210]));
  });
}

// Complete byte sequences captured from FFmpeg 7.0.2 with the same argv/input.
for (const [filter, expected] of [
  ["fps=5", [10, 30, 30, 60, 100, 150, 210, 210]],
  ["framerate=5:flags=0", [10, 26, 48, 76, 110, 150, 198, 210]],
  ["framerate=5:scene=100", [10, 26, 48, 76, 110, 150, 198, 210]],
  ["framerate=7:flags=0", [10, 21, 34, 51, 72, 94, 121, 150, 184, 210, 210]],
  ["framerate=2", [10, 60, 150]],
  ["framerate=8", [10, 10, 30, 45, 60, 80, 100, 125, 150, 180, 210, 210]],
  ["framerate=5/2", [10, 60, 100, 198]],
  ["framerate=5:interp_start=128:interp_end=128", [10, 30, 60, 60, 100, 150, 210, 210]],
  ["framerate=5:scene=0", [10, 30, 60, 60, 100, 150, 210, 210]],
  ["setpts=PTS+3,framerate=5", [10, 30, 48, 76, 110, 150, 198, 210]],
  ["select=not(mod(n\\,2)),framerate=5", [10, 10, 60, 60, 150, 150, 150, 150]],
  ["setpts=floor(N/2),framerate=5", [10, 60, 150, 150]],
  ["framerate=5,fps=source_fps", [10, 30, 48, 76, 110, 150, 198]],
  ["framerate=5,framerate=8:flags=0", [10, 23, 35, 46, 62, 80, 102, 125, 150, 180, 201, 209, 210]]
] as const) {
  it(`matches native pixels for ${filter}`, async () => {
    const result = await run(filter);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.deepEqual(result.bytes, Buffer.from(expected));
  });
}
for (const [pixels, expected] of [
  [[], []], [[10], [10]], [[10, 30], [10, 30, 30]],
  [[10, 200], [10, 200, 200]], [[10, 30, 60], [10, 30, 48, 60]]
]) {
  it(`flushes ${pixels!.length} source frames`, async () => {
    const result = await run("framerate=5", pixels!);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.deepEqual(result.bytes, Buffer.from(expected!));
  });
}
for (const width of [2, 31, 32, 33]) {
  it(`detects scene cuts on ${width}x2 grayscale frames`, async () => {
    const result = await run("framerate=5", source, width, 2);
    assert.equal(result.exitCode, 0, result.stderr);
    const expected = [10, width < 32 ? 30 : 26, 48, 76, 110, 150, 198, 210];
    assert.deepEqual(result.bytes, Buffer.from(expected.flatMap(value => Array<number>(width * 2).fill(value))));
  });
}
for (const [options, code] of [
  ["0", 234], ["bad", 234], ["5:interp_start=256", 222], ["5:scene=101", 222],
  ["5:enable=1", 176], ["5:bogus=1", 8]
] as const) {
  it(`rejects ${options} without overwriting the destination`, async () => {
    const result = await run(`framerate=${options}`);
    assert.equal(result.exitCode, code, result.stderr);
    assert.equal(result.bytes.toString(), "KEEP");
  });
}
it("preserves the native filter clock and duration ticks", async () => {
  const result = await run("framerate=5,showinfo");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.ok(result.stderr.includes("config in time_base: 1/20, frame_rate: 5/1"), result.stderr);
  assert.ok(result.stderr.includes("pts:28 pts_time:1.4"), result.stderr);
  assert.ok(result.stderr.includes("duration_time:0.05"), result.stderr);
});
it("honors output frame limits", async () => {
  const result = await run("framerate=5", source, 1, 1, false, ["-frames:v", "3"]);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.deepEqual(result.bytes, Buffer.from([10, 30, 48]));
});

for (const limits of [{ maxSamplesPerTrack: 6 }, { maxFrames: 6 }, { maxMemoryBytes: 800 }]) {
  it(`bounds frame expansion with ${JSON.stringify(limits)}`, async () => {
    const result = await run("framerate=1000", source, 1, 1, false, [], limits);
    assert.notEqual(result.exitCode, 0, result.stderr);
    assert.equal(result.bytes.toString(), "KEEP");
    assert.ok(result.stderr.includes(Object.keys(limits)[0]!), result.stderr);
  });
}
