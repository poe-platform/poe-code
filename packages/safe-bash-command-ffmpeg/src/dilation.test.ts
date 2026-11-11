import assert from "node:assert/strict";
import { it } from "node:test";
import { createHash } from "node:crypto";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";
import { MediaBudgetTracker } from "@poe-code/mp4-ast";
import { dilation } from "./dilation.js";

const gray = Buffer.from(Array.from({ length: 40 }, (_, i) => {
  const x = i % 8, y = Math.floor(i / 8);
  return x === 1 && y === 2 ? 245 : x === 6 && y === 2 ? 7 : (x < 4 ? 24 : 200) + y;
}));
const yuv = Buffer.concat([gray, gray.map(value => 255 - value), Buffer.from(gray).reverse()]);

async function run(filter: string, input = gray, format = "gray", size = "8x5") {
  const volume = Volume.fromJSON({ "/in.raw": input, "/out.raw": "KEEP" });
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-hide_banner", "-nostats", "-v", "error", "-y", "-f", "rawvideo", "-pixel_format", format,
      "-video_size", size, "-framerate", "4", "-i", "/in.raw", "-vf", filter,
      "-fps_mode", "passthrough", "-pix_fmt", format, "-bitexact", "-f", "rawvideo", "/out.raw"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: { async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, data: Uint8Array) { volume.writeFileSync(path, data); },
      async stat(path: string) { return volume.statSync(path); } },
    stdin: (async function* () {})(), stdout: { async write() {} },
    stderr: { async write(data: Uint8Array) { stderr += new TextDecoder().decode(data); } }
  } as never);
  return { ...result, stderr, output: volume.readFileSync("/out.raw") as Buffer };
}

it("preserves the grayscale and YUV null controls", async () => {
  for (const [format, input] of [["gray", gray], ["yuv444p", yuv]] as const) {
    const result = await run("null", input, format);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.deepEqual(result.output, input);
  }
});

// Complete native FFmpeg 7.0.2 output, including every border sample.
for (const [filter, input, format, hex] of [
  ["dilation", gray, "gray", "191919c9c9c9c9c9f5f5f5cacacacacaf5f5f5cbcbcbcbcbf5f5f5cccccccccc1c1c1ccccccccccc"],
  ["dilation=coordinates=16:threshold0=12", gray, "gray", "18181824c8c8c8c819191925c9c9c9c926f51a26caca13ca1b1b1b27cbcbcbcb1c1c1c28cccccccc"],
  ["dilation=threshold0=0:threshold1=12:threshold2=0", yuv, "yuv444p", "18181818c8c8c8c819191919c9c9c9c91af51a1acaca07ca1b1b1b1bcbcbcbcb1c1c1c1ccccccccce7e7e7e743373737e7e7e7e742424242e616e6e64141f841e5e5e5e540404040e4e4e4e43f343434cccccccc1c1c1c1ccbcbcbcb1b1b1b1bca07caca1a1af51ac9c9c9c919191919c8c8c8c818181818"]
] as const) {
  it(`matches native ${filter} on ${format}`, async () => {
    const result = await run(filter, input, format);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.deepEqual(result.output, Buffer.from(hex, "hex"));
  });
}

for (const [mask, hex] of [
  [1, "18181818c8c8c8c819191919c9c9c9c91af51a1acacac9caf51bf51bcbcbcbcb1c1c1c1ccccccccc"],
  [2, "18181818c8c8c8c819191919c9c9c9c91af51a1acacac9ca1bf51b1bcbcbcbcb1c1c1c1ccccccccc"],
  [4, "181818c8c8c8c8c8191919c8c9c9c9c91af51ac9cacac9caf51b1bcacbcbcbcb1c1c1ccbcccccccc"],
  [8, "18181818c8c8c8c819191919c9c9c9c9f5f5f51acacacaca1b1b1b1bcbcbcbcb1c1c1c1ccccccccc"],
  [16, "181818c8c8c8c8c8191919c9c9c9c9c9f5f51acacacacaca1b1b1bcbcbcbcbcb1c1c1ccccccccccc"],
  [32, "19191919c8c9c9c9f51af51ac9cacac91bf51b1bcacbcbcb1c1c1c1ccbcccccc1c1c1c1ccccccccc"],
  [64, "19191919c9c9c9c91af51a1acacac9ca1bf51b1bcbcbcbcb1c1c1c1ccccccccc1c1c1c1ccccccccc"],
  [128, "191919c9c9c9c9c9f51a1acacac9cac91bf51bcbcbcbcbcb1c1c1ccccccccccc1c1c1ccccccccccc"],
] as const) {
  it(`matches native neighbor mask ${mask} including reflected horizontal edges`, async () => {
    const result = await run(`dilation=coordinates=${mask}`);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.deepEqual(result.output, Buffer.from(hex, "hex"));
  });
}

it("accepts positional options, named instances, and a trailing separator", async () => {
  const result = await run("dilation@right=16:12:");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.deepEqual(result.output, (await run("dilation=coordinates=16:threshold0=12")).output);
});

it("preserves pixels for zero coordinates, zero threshold, and disabled timeline", async () => {
  for (const filter of ["dilation=coordinates=0", "dilation=threshold0=0", "dilation=enable=0"]) {
    const result = await run(filter);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.deepEqual(result.output, gray);
  }
});

it("retains frame timing while filtering only the enabled frame", async () => {
  const result = await run("dilation=enable='eq(t,0.25)'", Buffer.concat([gray, gray, gray]));
  assert.equal(result.exitCode, 0, result.stderr);
  assert.deepEqual(result.output, Buffer.concat([gray, (await run("dilation")).output, gray]));
});

for (const option of ["coordinates=-1", "coordinates=256", "threshold0=-1", "threshold1=65536", "threshold2=nan", "threshold3=", "unknown=1"]) {
  it(`rejects ${option} without replacing output`, async () => {
    const result = await run(`dilation=${option}`);
    assert.notEqual(result.exitCode, 0);
    assert.match(result.stderr, /dilation/);
    assert.equal(result.output.toString(), "KEEP");
  });
}

// Native full-frame references verify chroma dimensions and high-bit-depth thresholds.
for (const [format, hash] of [
  ["yuv420p", "f087a6b47537a16670d984ab886e9343bdb41b502b1b06edb1e2ec98df3d1fb6"],
  ["yuv422p", "f4fa2162c27d7930d773855e71fc0f4000aaf8916835f320d8eae3ce542fda16"],
  ["yuv444p", "27ad2ee7a2149a419163bc02f07c70f216408dd38c076d0a89d73efb57dbd2fb"],
  ["gray16le", "f3a5d253a42fbf4bf59b4bcd7948ae3b61eda8d8328b38f953739e8c311dd500"],
  ["gray16be", "c2b43fbb9299d56d5bc71f38312fbf51d402d370a594479261b54ca6c105b001"],
  ["yuv420p10le", "0417f62fa1c3ed826d3e719b129ac8e735d592c3400361d9a25320288b370486"],
  ["yuv444p10le", "69168f82edfc4b895b18443f08cffb6bda6534f49c9f4ea58d8b5c7ae5dd8658"],
  ["yuv444p16le", "98aa48bba7e353326b928044fb0352489ebf5edb441de1f8fd0bcd0344b33c9a"],
] as const) {
  it(`matches native sample precision and plane thresholds on ${format}`, async () => {
    const depth = format.includes("10") ? 10 : format.includes("16") ? 16 : 8;
    const count = format.startsWith("gray") ? 40 : format.startsWith("yuv420") ? 64 : format === "yuv422p" ? 80 : 120;
    const input = Buffer.alloc(count * (depth > 8 ? 2 : 1));
    for (let i = 0; i < count; i++) {
      const value = (i * 157 + i * i * 13 + 101) % 2 ** depth;
      if (depth === 8) input[i] = value;
      else if (format.endsWith("be")) input.writeUInt16BE(value, i * 2);
      else input.writeUInt16LE(value, i * 2);
    }
    const result = await run("dilation=coordinates=173:threshold0=12:threshold1=0:threshold2=37", input, format);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.output.length, input.length);
    assert.equal(createHash("sha256").update(result.output).digest("hex"), hash);
  });
}

it("accounts for output memory, preserves input and timing, and observes cancellation", async () => {
  const data = Uint8Array.from(Array.from(gray).flatMap(value => [value, value, value, 255]));
  const original = data.slice();
  const frame = { data, width: 8, height: 5, ptsSeconds: 1, durationSeconds: 0.25, keyframe: true };
  await assert.rejects(dilation([frame], "", "gray", new MediaBudgetTracker({ maxMemoryBytes: data.length - 1 })), /maxMemoryBytes/);
  const [filtered] = await dilation([frame], "", "gray", new MediaBudgetTracker());
  const expected = Buffer.from("191919c9c9c9c9c9f5f5f5cacacacacaf5f5f5cbcbcbcbcbf5f5f5cccccccccc1c1c1ccccccccccc", "hex");
  assert.deepEqual(filtered, { ...frame, data: Uint8Array.from(Array.from(expected).flatMap(value => [value, value, value, 255])) });
  assert.deepEqual(data, original);
  const controller = new AbortController();
  const filtering = dilation([frame], "", "gray", new MediaBudgetTracker(), controller.signal);
  controller.abort(new Error("stop dilation"));
  await assert.rejects(filtering, /stop dilation/);
});
