import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

async function run(input: Buffer, source = "yuva420p", size = "2x4", outputArgs = ["-vf", "null", "-pix_fmt", "rgba"], options: Parameters<typeof createFfmpegCommand>[0] = {}) {
  const volume = Volume.fromJSON({ "/in.raw": input });
  const stdout: Buffer[] = [];
  let stderr = "";
  const result = await createFfmpegCommand(options).execute({
    args: ["-hide_banner", "-nostats", "-v", outputArgs.includes("showinfo") ? "info" : "error",
      "-f", "rawvideo", "-pixel_format", source, "-video_size", size, "-framerate", "4", "-i", "/in.raw",
      ...outputArgs, "-fps_mode", "passthrough", "-f", "rawvideo", "pipe:1"],
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

// Complete native FFmpeg 7.0.2 output, including each full-resolution alpha sample.
const input = Buffer.from("11589fe62d74bb024990d71e65acf33a81c80f56", "hex");
const rgba = "8b000065dd2100acff7437f3ffc78a3a0069418100bc94c82affe70f00370f56";
for (const [format, bytes, expected] of [
  ["yuva420p", input, rgba],
  ["rgba", Buffer.from("11589fe62d74bb024990d71e65acf33a81c80f569de42b72b900478ed51c63aa", "hex"),
    "11589fe62d74bb024990d71e65acf33a81c80f569de42b72b900478ed51c63aa"]
] as const) {
  it(`matches native raw bytes for ${format} input through null`, async () => {
    const result = await run(bytes, format);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stderr, "");
    assert.equal(result.output.toString("hex"), expected);
  });
}

it("decodes each YUVA420 frame independently and skips a short final packet", async () => {
  const second = Buffer.from(input);
  second.fill(0, 12);
  second[19] = 255;
  const result = await run(Buffer.concat([input, second, input.subarray(0, 19)]));
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stderr, "");
  const expected = Buffer.from(rgba, "hex");
  for (let i = 0; i < 8; i++) expected[i * 4 + 3] = second[12 + i]!;
  assert.deepEqual(result.output, Buffer.concat([Buffer.from(rgba, "hex"), expected]));
});

it("reads full-resolution alpha after rounded-up chroma planes for odd dimensions", async () => {
  const result = await run(Buffer.from(Array.from({ length: 26 }, (_, i) => i)), "yuva420p", "3x3");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stderr, "");
  assert.equal(result.output.toString("hex"), "0079001100790012007b0013007b0014007b0015007c0016007e0017007e0018007f0019");
});

it("keeps all four YUVA420 planes and a short final packet during stream copy", async () => {
  const bytes = Buffer.concat([input, input.subarray(0, 19)]);
  const result = await run(bytes, "yuva420p", "2x4", ["-c:v", "copy"], { limits: { maxFrames: 0 } });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stderr, "");
  assert.deepEqual(result.output, bytes);
});

it("reports native YUVA420 timing and statistics for all four planes", async () => {
  const result = await run(Buffer.concat([input, input]), "yuva420p", "2x4", ["-vf", "showinfo", "-pix_fmt", "rgba"]);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.output.toString("hex"), rgba.repeat(2));
  assert.match(result.stderr, /n:0 pts:0 pts_time:0 duration:1 duration_time:0.25 fmt:yuva420p cl:unspecified sar:0\/1 s:2x4 i:P iskey:1 type:I/);
  assert.match(result.stderr, /n:1 pts:1 pts_time:0.25 duration:1 duration_time:0.25 fmt:yuva420p cl:unspecified sar:0\/1 s:2x4 i:P iskey:1 type:I/);
  assert.match(result.stderr, /checksum:5CD00906 plane_checksum:\[0EB0034C 012200D9 01CC00F5 138003EC\] mean:\[106 109 123 126\] stdev:\[77.2 35.5 92.5 71.1\]/);
});

for (const limits of [{ maxFrames: 0 }, { maxSamplesPerTrack: 0 }, { maxMemoryBytes: 1 }, { maxOutputBytes: 31 }]) {
  it(`enforces YUVA420 resource limits before emitting output: ${JSON.stringify(limits)}`, async () => {
    const result = await run(input, "yuva420p", "2x4", undefined, { limits });
    assert.notEqual(result.exitCode, 0);
    assert.match(result.stderr, /Resource limit exceeded/);
    assert.equal(result.output.length, 0);
  });
}

// Complete FFmpeg 7.0.2 reference planes: spatial filters only reorder samples.
const spatialInput = "6464646464646464808080807b98b5d2ef0c2946";
for (const [filter, expected] of [
  ["transpose=clock", "646464646464646480808080ef7b0c9829b546d2"],
  ["hflip", "646464646464646480808080d2b5987b46290cef"],
  ["vflip", "646464646464646480808080ef0c29467b98b5d2"],
  ["transpose=clock,transpose=cclock", spatialInput],
  ["null", spatialInput],
  ["transpose=clock:landscape", spatialInput]
] as const) {
  it(`preserves native YUVA420 samples through ${filter}`, async () => {
    const result = await run(Buffer.from(spatialInput, "hex"), "yuva420p", "4x2",
      ["-vf", filter, "-frames:v", "1", "-pix_fmt", "yuva420p"]);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stderr, "");
    assert.equal(result.output.toString("hex"), expected);
  });
}

// A 3x2 frame has six luma/alpha samples and two samples in each chroma plane.
const oddSpatialInput = "000102030405060708090a0b0c0d0e0f";
for (const [filter, expected] of [
  ["transpose=clock", "030004010502060708090d0a0e0b0f0c"],
  ["transpose=cclock", "020501040003070609080c0f0b0e0a0d"],
  ["transpose=cclock_flip", "000301040205060708090a0d0b0e0c0f"],
  ["transpose=clock_flip", "050204010300070609080f0c0e0b0d0a"],
  ["hflip", "020100050403070609080c0b0a0f0e0d"],
  ["vflip", "030405000102060708090d0e0f0a0b0c"],
  ["hflip,hflip", oddSpatialInput],
  ["vflip,vflip", oddSpatialInput],
  ["transpose=clock,transpose=cclock", oddSpatialInput]
] as const) {
  it(`reorders every odd-sized YUVA420 plane in multiple frames through ${filter}`, async () => {
    const input = Buffer.from(oddSpatialInput, "hex");
    const output = Buffer.from(expected, "hex");
    const result = await run(Buffer.concat([input, input.map(value => value + 128)]), "yuva420p", "3x2",
      ["-vf", filter, "-pix_fmt", "yuva420p"]);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stderr, "");
    assert.deepEqual(result.output, Buffer.concat([output, output.map(value => value + 128)]));
  });
}
