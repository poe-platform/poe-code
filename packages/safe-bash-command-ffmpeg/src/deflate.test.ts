import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { MediaBudgetTracker } from "@poe-code/mp4-ast";
import { deflate } from "./deflate.js";
import { createFfmpegCommand } from "./index.js";

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
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, data: Uint8Array) { volume.writeFileSync(path, data); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(), stdout: { async write() {} },
    stderr: { async write(data: Uint8Array) { stderr += new TextDecoder().decode(data); } }
  } as never);
  return { ...result, stderr, output: volume.readFileSync("/out.raw") as Buffer };
}

for (const [input, format] of [[gray, "gray"], [yuv, "yuv444p"]] as const) {
  it(`preserves the ${format} control`, async () => {
    const result = await run("null", input, format);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.deepEqual(result.output, input);
  });
}

// Complete native FFmpeg 7.0.2 frames, including horizontal reflection and repeated edge rows.
const unrestricted = "1818181886c8c8c81919191987b0b0981a1a1a1a88b107991b1b1b1b89b2b29a1b1b1b1c89cbcbcb";
const limited = "18181818bcc8c8c819191919bdbdbdbd1ae91a1abebe07be1b1b1b1bbfbfbfbf1b1b1b1cc0cbcbcb";
for (const [filter, expected] of [
  ["deflate", unrestricted],
  ["deflate=threshold0=12", limited],
  ["deflate@soften=12", limited],
  ["deflate=12.5", limited],
  ["deflate=threshold0=6+6:", limited],
  ["deflate=threshold0=0:threshold0=default", unrestricted]
]) {
  it(`matches every native grayscale sample for ${filter}`, async () => {
    const result = await run(filter!);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.deepEqual(result.output, Buffer.from(expected!, "hex"));
  });
}

it("limits U independently while preserving Y and V byte-for-byte", async () => {
  const result = await run("deflate=threshold0=0:threshold1=12:threshold2=0", yuv, "yuv444p");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.deepEqual(result.output, Buffer.from(
    "18181818c8c8c8c819191919c9c9c9c91af51a1acaca07ca1b1b1b1bcbcbcbcb1c1c1c1ccccccccc" +
    "e6e6e6db37363636dadadada36363636d90ad9d93535ec35d8d8d8d834343434e3e3e3d733333333" +
    "cccccccc1c1c1c1ccbcbcbcb1b1b1b1bca07caca1a1af51ac9c9c9c919191919c8c8c8c818181818", "hex"));
});

for (const [format, height, expected] of [
  ["yuv420p", 3, "134b88be074481b2ef3875a6c9dd1f4a7589b4df214c77a1"],
  ["yuv422p", 5, "134b88be074481b2ef3875a6e32c699ad7205d8ec9dd1f4a7589b4df214c778bb6e1234e79a3b8e3"]
] as const) {
  it(`matches native thresholds on subsampled ${format} borders`, async () => {
    const input = Buffer.concat([gray,
      Buffer.from(Array.from({ length: 4 * height }, (_, i) => (i * 61 + 19) % 256)),
      Buffer.from(Array.from({ length: 4 * height }, (_, i) => (i * 43 + 201) % 256))]);
    const result = await run("deflate=0:12:23", input, format);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.deepEqual(result.output, Buffer.concat([gray, Buffer.from(expected, "hex")]));
  });
}

it("preserves disabled planes and frames", async () => {
  for (const filter of ["deflate=0:0:0:0", "deflate=enable=0"]) {
    const result = await run(filter, yuv, "yuv444p");
    assert.equal(result.exitCode, 0, result.stderr);
    assert.deepEqual(result.output, yuv);
  }
  const result = await run("deflate=enable=gte(n\\,1)", Buffer.concat([gray, gray]));
  assert.equal(result.exitCode, 0, result.stderr);
  assert.deepEqual(result.output, Buffer.concat([gray, Buffer.from(unrestricted, "hex")]));
});

for (const option of ["threshold0=-1", "threshold1=65536", "threshold2=nan", "threshold3=no",
  "threshold0=", "unknown=1", "1:2:3:4:5"]) {
  it(`rejects ${option} before replacing output`, async () => {
    const result = await run(`deflate=${option}`);
    assert.notEqual(result.exitCode, 0);
    assert.match(result.stderr, /deflate/);
    assert.equal(result.output.toString(), "KEEP");
  });
}

it("rejects unsupported pixel formats before replacing output", async () => {
  const result = await run("deflate", Buffer.alloc(120, 20), "rgb24");
  assert.notEqual(result.exitCode, 0);
  assert.match(result.stderr, /deflate: only 8-bit grayscale or planar YUV/);
  assert.equal(result.output.toString(), "KEEP");
});

it("preserves input and timing metadata while enforcing budgets and cancellation", async () => {
  const data = new Uint8Array(8 * 5 * 4).fill(20);
  const frame = { data, width: 8, height: 5, ptsSeconds: 1.25, durationSeconds: 0.25, keyframe: true, offset: 1024 };
  const [filtered] = await deflate([frame], "", "gray", new MediaBudgetTracker());
  assert.equal(filtered!.ptsSeconds, frame.ptsSeconds);
  assert.equal(filtered!.durationSeconds, frame.durationSeconds);
  assert.equal(filtered!.offset, frame.offset);
  assert.equal(filtered!.keyframe, frame.keyframe);
  assert.deepEqual(data, new Uint8Array(data.length).fill(20));
  await assert.rejects(deflate([frame], "", "gray", new MediaBudgetTracker({ maxMemoryBytes: 64 })), /maxMemoryBytes/);
  await assert.rejects(deflate([frame], "", "gray", new MediaBudgetTracker({ maxCpuMs: -1 })), /maxCpuMs/);
  const controller = new AbortController();
  const pending = deflate([frame], "", "gray", new MediaBudgetTracker(), controller.signal);
  controller.abort();
  await assert.rejects(pending, { name: "AbortError" });
});
