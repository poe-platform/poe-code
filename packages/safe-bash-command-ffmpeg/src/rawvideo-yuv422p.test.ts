import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const source = (length: number) => Buffer.from(Array.from({ length }, (_, i) => (i * 29 + 17) % 256));

async function run(bytes: Uint8Array, format: string, outputArgs: string[], options: Parameters<typeof createFfmpegCommand>[0] = {}, size = "4x2") {
  const volume = Volume.fromJSON({ "/in.raw": Buffer.from(bytes), "/out.raw": "KEEP" });
  let stderr = "";
  const result = await createFfmpegCommand(options).execute({
    args: ["-y", "-v", "error", "-f", "rawvideo", "-pixel_format", format, "-video_size", size,
      "-framerate", "2", "-i", "/in.raw", ...outputArgs, "-f", "rawvideo", "/out.raw"],
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

// Native FFmpeg 7.0.2 reference bytes for two 4x2 frames.
for (const [inputFormat, outputFormat, length, expected] of [
  ["yuv422p", "yuv422p", 32, "112e4b6885a2bfdcf91633506d8aa7c4e1fe1b3855728facc9e603203d5a7794"],
  ["yuv422p", "rgb24", 32, "0000f50301ff536400758600c68600e8a80effa56affc78c88ffffaaffff0002d90024fb41870063a900b2a700d4c900"],
  ["rgb24", "yuv422p", 48, "337ec83782cd3b869191919171717171b8408bbc448fc048595991597a7a717a"],
  ["yuv420p", "yuv420p", 24, "112e4b6885a2bfdcf91633506d8aa7c4e1fe1b3855728fac"],
  ["yuv444p", "yuv444p", 48, "112e4b6885a2bfdcf91633506d8aa7c4e1fe1b3855728facc9e603203d5a7794b1ceeb0825425f7c99b6d3f00d2a4764"]
] as const) {
  it(`matches native rawvideo ${inputFormat} to ${outputFormat} through null`, async () => {
    const result = await run(source(length), inputFormat, ["-vf", "null", "-pix_fmt", outputFormat]);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.output.toString("hex"), expected);
  });
}

for (const copy of [false, true]) {
  it(`handles odd YUV422 dimensions and a partial final packet (copy=${copy})`, async () => {
    // A 3x3 frame contains nine Y samples and six samples in each chroma plane.
    const bytes = source(44);
    const result = await run(bytes, "yuv422p", ["-c:v", copy ? "copy" : "rawvideo"],
      copy ? { limits: { maxFrames: 0 }, features: { videoTranscode: false } } : {}, "3x3");
    assert.equal(result.exitCode, 0, result.stderr);
    assert.deepEqual(result.output, copy ? bytes : bytes.subarray(0, 42));
  });
}

it("infers YUV422 raw output from the format filter", async () => {
  const result = await run(source(48), "rgb24", ["-vf", "format=yuv422p"]);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.output.toString("hex"), "337ec83782cd3b869191919171717171b8408bbc448fc048595991597a7a717a");
});

it("checks YUV422 output size before replacing the destination", async () => {
  const result = await run(source(48), "rgb24", ["-pix_fmt", "yuv422p"], { limits: { maxOutputBytes: 31 } });
  assert.notEqual(result.exitCode, 0);
  assert.match(result.stderr, /maxOutputBytes/);
  assert.equal(result.output.toString(), "KEEP");
});

it("checks YUV422 packet limits before replacing the destination", async () => {
  const result = await run(source(32), "yuv422p", ["-c:v", "copy"], { limits: { maxSamplesPerTrack: 1 } });
  assert.notEqual(result.exitCode, 0);
  assert.match(result.stderr, /maxSamplesPerTrack/);
  assert.equal(result.output.toString(), "KEEP");
});
