import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

async function run(input: Buffer, format: string, size = "4x2", outputArgs = ["-vf", "null", "-pix_fmt", "yuv422p"], options: Parameters<typeof createFfmpegCommand>[0] = {}) {
  const volume = Volume.fromJSON({ "/in.raw": input });
  const stdout: Buffer[] = [];
  let stderr = "";
  const result = await createFfmpegCommand(options).execute({
    args: ["-v", "error", "-f", "rawvideo", "-pixel_format", format, "-video_size", size,
      "-i", "/in.raw", ...outputArgs, "-f", "rawvideo", "pipe:1"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(),
    stdout: { async write(bytes: Uint8Array) { stdout.push(Buffer.from(bytes)); } },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  assert.deepEqual(volume.readFileSync("/in.raw"), input);
  return { ...result, stderr, output: Buffer.concat(stdout) };
}

// Exact native FFmpeg 7.0.2 outputs for distinct samples at every packed position.
const input = Buffer.from("2f3a45505b66717c87929da8b3bec9d4", "hex");
for (const [format, expected] of [
  ["yuyv422", "2f455b71879db3c93a6692be507ca8d4"],
  ["uyvy422", "3a50667c92a8bed42f5b87b345719dc9"],
  ["yuv422p", "2f3a45505b66717c87929da8b3bec9d4"]
] as const) {
  it(`decodes ${format} input through null to exact planar YUV422 bytes`, async () => {
    const result = await run(input, format);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stderr, "");
    assert.equal(result.output.toString("hex"), expected);
  });
}

for (const [format, planar, oddPlanar] of [
  ["yuyv422", "2f455b71879db3c93a6692be507ca8d4", "2f455b879db33a6692be507ca8d4"],
  ["uyvy422", "3a50667c92a8bed42f5b87b345719dc9", "3a506692a8be2f5b87b345719dc9"]
] as const) {
  it(`keeps ${format} row and frame boundaries with odd widths`, async () => {
    const result = await run(Buffer.concat([input, Buffer.from(input).reverse()]), format, "3x2");
    const second = format === "yuyv422" ? "d4bea87c6650c99d7145b3875b2f" : "c9b39d715b45d4a87c50be92663a";
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stderr, "");
    assert.equal(result.output.toString("hex"), oddPlanar + second);
  });

  it(`renders ${format} with planar YUV422 chroma and opaque alpha`, async () => {
    const args = ["-vf", "null", "-pix_fmt", "rgba"];
    const result = await run(input, format, "4x2", args);
    const control = await run(Buffer.from(planar, "hex"), "yuv422p", "4x2", args);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(control.exitCode, 0, control.stderr);
    assert.deepEqual(result.output, control.output);
    for (let offset = 3; offset < result.output.length; offset += 4) assert.equal(result.output[offset], 255);
  });

  it(`decodes complete ${format} frames and ignores a short final packet`, async () => {
    const result = await run(Buffer.concat([input, Buffer.from([1, 2, 3])]), format);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.output.toString("hex"), planar);
  });

  it(`copies original ${format} bytes including a short final packet without decoding`, async () => {
    const bytes = Buffer.concat([input, Buffer.from([1, 2, 3])]);
    const result = await run(bytes, format, "3x2", ["-c:v", "copy"], { limits: { maxFrames: 0 } });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stderr, "");
    assert.deepEqual(result.output, bytes);
  });

  it(`packetizes odd-width ${format} stream copy using complete pixel pairs per row`, async () => {
    const result = await run(Buffer.concat([input, input]), format, "3x2", ["-c:v", "copy", "-frames:v", "1"]);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.deepEqual(result.output, input);
  });

  for (const limits of [{ maxFrames: 0 }, { maxSamplesPerTrack: 0 }, { maxMemoryBytes: 64 }, { maxOutputBytes: 15 }]) {
    it(`enforces ${format} resource limits before emitting output: ${JSON.stringify(limits)}`, async () => {
      const result = await run(input, format, "4x2", undefined, { limits });
      assert.notEqual(result.exitCode, 0);
      assert.match(result.stderr, /Resource limit exceeded/);
      assert.equal(result.output.length, 0);
    });
  }
}
