import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2 reference bytes for two 2x2 frames.
const pixels = Buffer.from("113a638cb5de07305982abd4fd264f78a1caf31c456e97c0", "hex");
const yuv = Buffer.from("3ba5339c989898986b6b6b6b6c94638b72987298dc6bdc6b", "hex");

async function run(bytes: Uint8Array, format: string, outputArgs: string[], options: Parameters<typeof createFfmpegCommand>[0] = {}) {
  const volume = Volume.fromJSON({ "/in.raw": Buffer.from(bytes), "/out.raw": "keep" });
  let stderr = "";
  const result = await createFfmpegCommand(options).execute({
    args: ["-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", format, "-s", "2x2", "-r", "1",
      "-i", "/in.raw", ...outputArgs, "-f", "rawvideo", "/out.raw"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, data: Uint8Array) { volume.writeFileSync(path, data); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(), stdout: { async write() {} },
    stderr: { async write(data: Uint8Array) { stderr += new TextDecoder().decode(data); } }
  } as never);
  return { ...result, stderr, output: volume.readFileSync("/out.raw") };
}

for (const frameLimit of [false, true]) {
  it(`copies YUV444 packets without decoding (one frame=${frameLimit})`, async () => {
    const result = await run(pixels, "yuv444p", ["-c:v", "copy", ...(frameLimit ? ["-frames:v", "1"] : [])],
      { limits: { maxFrames: 0 }, features: { videoTranscode: false } });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.deepEqual(result.output, frameLimit ? pixels.subarray(0, 12) : pixels);
  });
}

for (const filters of [[], ["-vf", "null"], ["-vf", "format=yuv444p"]]) {
  it(`serializes RGB24 as YUV444 using native plane bytes (${filters.join(" ") || "no filter"})`, async () => {
    const result = await run(pixels, "rgb24", [...filters, "-pix_fmt", "yuv444p"]);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.deepEqual(result.output, yuv);
  });
}

it("infers YUV444 output from the format filter", async () => {
  const result = await run(pixels, "rgb24", ["-vf", "format=yuv444p"]);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.deepEqual(result.output, yuv);
});

for (const copy of [false, true]) {
  it(`preserves YUV444 planes with a partial final packet (copy=${copy})`, async () => {
    const bytes = Buffer.concat([pixels, Buffer.from([90, 0])]);
    const result = await run(bytes, "yuv444p", ["-c:v", copy ? "copy" : "rawvideo"]);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.deepEqual(result.output, copy ? bytes : pixels);
  });
}

it("checks YUV444 output size before replacing the destination", async () => {
  const result = await run(pixels, "rgb24", ["-pix_fmt", "yuv444p"], { limits: { maxOutputBytes: 23 } });
  assert.notEqual(result.exitCode, 0);
  assert.match(result.stderr, /maxOutputBytes/);
  assert.equal(result.output.toString(), "keep");
});

it("checks YUV444 stream-copy packet limits without replacing the destination", async () => {
  const result = await run(pixels, "yuv444p", ["-c:v", "copy"], { limits: { maxSamplesPerTrack: 1 } });
  assert.notEqual(result.exitCode, 0);
  assert.match(result.stderr, /maxSamplesPerTrack/);
  assert.equal(result.output.toString(), "keep");
});
