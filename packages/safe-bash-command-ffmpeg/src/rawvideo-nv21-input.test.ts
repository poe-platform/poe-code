import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

async function run(input: string, source = "nv21", size = "4x2", outputArgs = ["-vf", "null", "-pix_fmt", "yuv420p"], options: Parameters<typeof createFfmpegCommand>[0] = {}) {
  const bytes = Buffer.from(input, "hex");
  const volume = Volume.fromJSON({ "/in.raw": bytes });
  const stdout: Buffer[] = [];
  let stderr = "";
  const result = await createFfmpegCommand(options).execute({
    args: ["-v", "error", "-f", "rawvideo", "-pixel_format", source, "-video_size", size,
      "-i", "/in.raw", ...outputArgs, "-f", "rawvideo", "pipe:1"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(),
    stdout: { async write(data: Uint8Array) { stdout.push(Buffer.from(data)); } },
    stderr: { async write(data: Uint8Array) { stderr += new TextDecoder().decode(data); } }
  } as never);
  assert.deepEqual(volume.readFileSync("/in.raw"), bytes);
  return { ...result, stderr, output: Buffer.concat(stdout).toString("hex") };
}

// Exact native FFmpeg 7.0.2 output: NV21 stores V/U pairs after the Y plane.
const input = "2f3a45505b66717c87929da8";
for (const [format, expected] of [
  ["nv21", "2f3a45505b66717c92a8879d"],
  ["yuv420p", input]
]) {
  it(`matches native ${format} input bytes through null`, async () => {
    const result = await run(input, format);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stderr, "");
    assert.equal(result.output, expected);
  });
}

it("deinterleaves NV21 frames independently with odd dimensions", async () => {
  const result = await run("0001020304050607081020304050607080fffefdfcfbfaf9f8f78070605040302010", "nv21", "3x3");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stderr, "");
  assert.equal(result.output, "0001020304050607082040608010305070fffefdfcfbfaf9f8f77050301080604020");
});

it("renders NV21 chroma with planar YUV420 subsampling and opaque alpha", async () => {
  const args = ["-vf", "null", "-pix_fmt", "rgba"];
  const actual = await run(input, "nv21", "2x4", args);
  const control = await run("2f3a45505b66717c92a8879d", "yuv420p", "2x4", args);
  assert.equal(actual.exitCode, 0, actual.stderr);
  assert.equal(control.exitCode, 0, control.stderr);
  assert.equal(actual.output, control.output);
  const rgba = Buffer.from(actual.output, "hex");
  assert.equal(rgba.length, 32);
  for (let pixel = 0; pixel < 8; pixel++) assert.equal(rgba[pixel * 4 + 3], 255);
});

it("copies original NV21 packets including a short final packet", async () => {
  const result = await run(input + "010203", "nv21", "4x2", ["-c:v", "copy"]);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stderr, "");
  assert.equal(result.output, input + "010203");
});

for (const limits of [{ maxFrames: 0 }, { maxSamplesPerTrack: 0 }, { maxMemoryBytes: 1 }, { maxOutputBytes: 11 }]) {
  it(`enforces NV21 resource limits before output: ${JSON.stringify(limits)}`, async () => {
    const result = await run(input, "nv21", "4x2", undefined, { limits });
    assert.notEqual(result.exitCode, 0);
    assert.ok(result.stderr.includes("Resource limit exceeded"), result.stderr);
    assert.equal(result.output, "");
  });
}
