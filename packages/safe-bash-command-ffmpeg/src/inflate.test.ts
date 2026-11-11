import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const gray = Buffer.from(Array.from({ length: 40 }, (_, i) => {
  const x = i % 8, y = Math.floor(i / 8);
  return x === 1 && y === 2 ? 245 : x === 6 && y === 2 ? 7 : (x < 4 ? 24 : 200) + y;
}));
const yuv = Buffer.concat([gray, Buffer.from(gray).map(value => 255 - value), Buffer.from(gray).reverse()]);

async function run(filter: string, input = gray, format = "gray", graph = false) {
  const volume = Volume.fromJSON({ "/in.raw": input });
  const chunks: Uint8Array[] = [];
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-hide_banner", "-nostats", "-v", "error", "-f", "rawvideo", "-pixel_format", format,
      "-video_size", "8x5", "-framerate", "4", "-i", "/in.raw",
      graph ? "-filter_complex" : "-vf", graph ? `[0:v]${filter}[v]` : filter,
      ...(graph ? ["-map", "[v]"] : []), "-fps_mode", "passthrough", "-pix_fmt", format,
      "-bitexact", "-f", "rawvideo", "pipe:1"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(),
    stdout: { async write(bytes: Uint8Array) { chunks.push(bytes.slice()); } },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  return { ...result, stderr, output: Buffer.concat(chunks) };
}

// Complete native FFmpeg 7.0.2 output, including all border samples.
for (const [filter, expected] of [
  ["inflate", "1818185ac8c8c8c84f34345bc9c9c9c950f5355ccacacaca5136365dcbcbcbcb1c1c1c5dcccccccc"],
  ["inflate=threshold0=12", "18181824c8c8c8c825252525c9c9c9c926f52626caca13ca27272727cbcbcbcb1c1c1c28cccccccc"]
]) {
  it(`matches native ${filter} across the entire grayscale frame`, async () => {
    const result = await run(filter!);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.output.toString("hex"), expected);
  });
}

it("limits inflate separately on each YUV plane in simple and complex graphs", async () => {
  for (const graph of [false, true]) {
    const result = await run("inflate=threshold0=0:threshold1=12:threshold2=0", yuv, "yuv444p", graph);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.output.toString("hex"),
      "18181818c8c8c8c819191919c9c9c9c91af51a1acaca07ca1b1b1b1bcbcbcbcb1c1c1c1ccccccccce7e7e7e743373737e6e6e6e642424242e516e5e54141f841e4e4e4e440404040e3e3e3e33f333333cccccccc1c1c1c1ccbcbcbcb1b1b1b1bca07caca1a1af51ac9c9c9c919191919c8c8c8c818181818");
    assert.deepEqual(result.output.subarray(0, 40), yuv.subarray(0, 40));
    assert.deepEqual(result.output.subarray(80), yuv.subarray(80));
  }
});

for (const [input, format] of [[gray, "gray"], [yuv, "yuv444p"]] as const) {
  it(`preserves the ${format} null control`, async () => {
    const result = await run("null", input, format);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.deepEqual(result.output, input);
  });
}

it("accepts positional threshold expressions and preserves disabled frame timing", async () => {
  const limited = await run("inflate=12");
  const named = await run("inflate=threshold0=6*2");
  assert.equal(limited.exitCode, 0, limited.stderr);
  assert.equal(named.exitCode, 0, named.stderr);
  assert.deepEqual(limited.output, named.output);
  const result = await run("inflate=12:enable='eq(t,0.25)'", Buffer.concat([gray, gray, gray]));
  assert.equal(result.exitCode, 0, result.stderr);
  assert.deepEqual(result.output, Buffer.concat([gray, limited.output, gray]));
});

for (const [input, format] of [[gray, "gray"], [yuv, "yuv444p"]] as const) {
  for (const filter of ["inflate=0:0:0:0", "inflate=enable=0"]) {
    it(`preserves ${format} with ${filter}`, async () => {
      const result = await run(filter, input, format);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.deepEqual(result.output, input);
    });
  }
}

for (const option of ["threshold0=-1", "threshold1=65536", "threshold2=nan", "threshold3=", "coordinates=1", "0:0:0:0:1"]) {
  it(`rejects invalid inflate option ${option} before emitting output`, async () => {
    const result = await run(`inflate=${option}`);
    assert.notEqual(result.exitCode, 0);
    assert.ok(result.stderr.includes("inflate"), result.stderr);
    assert.equal(result.output.length, 0);
  });
}

it("bounds allocations, preserves source data and metadata, and checks cancellation", async () => {
  const { MediaBudgetTracker } = await import("@poe-code/mp4-ast");
  const { inflate } = await import("./inflate.js");
  const data = Uint8Array.from({ length: 8 * 5 * 4 }, (_, i) => i % 4 === 3 ? 255 : gray[Math.floor(i / 4)]!);
  const original = data.slice();
  const frame = { data, width: 8, height: 5, ptsSeconds: 1, durationSeconds: 0.25, keyframe: true };
  await assert.rejects(inflate([frame], "", "gray", new MediaBudgetTracker({ maxMemoryBytes: data.length - 1 })), /maxMemoryBytes/);
  const budget = new MediaBudgetTracker();
  const [filtered] = await inflate([frame], "", "gray", budget);
  assert.equal(filtered!.ptsSeconds, frame.ptsSeconds);
  assert.equal(filtered!.durationSeconds, frame.durationSeconds);
  assert.equal(filtered!.keyframe, true);
  assert.deepEqual(data, original);
  assert.equal(budget.getStats().currentMemoryBytes, data.length);
  const expected = await run("inflate");
  assert.deepEqual(filtered!.data, Uint8Array.from({ length: data.length }, (_, i) => i % 4 === 3 ? 255 : expected.output[Math.floor(i / 4)]!));
  const controller = new AbortController();
  const rendering = inflate([frame], "", "gray", new MediaBudgetTracker(), controller.signal);
  controller.abort(new Error("stop inflate"));
  await assert.rejects(rendering, /stop inflate/);
});
