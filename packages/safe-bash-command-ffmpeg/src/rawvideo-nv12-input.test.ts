import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

async function run(input: Buffer, source = "nv12", size = "2x4", outputArgs = ["-vf", "null", "-pix_fmt", "yuv420p"], options: Parameters<typeof createFfmpegCommand>[0] = {}) {
  const volume = Volume.fromJSON({ "/in.raw": input });
  const stdout: Buffer[] = [];
  let stderr = "";
  const result = await createFfmpegCommand(options).execute({
    args: ["-hide_banner", "-nostats", "-v", outputArgs.includes("format=yuv420p,showinfo") ? "info" : "error",
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

// Full native FFmpeg 7.0.2 stdout: NV12 UV pairs become separate U and V planes.
const input = Buffer.from("11589fe62d74bb024990d71e", "hex");
for (const [format, expected] of [
  ["nv12", "11589fe62d74bb0249d7901e"],
  ["yuv420p", "11589fe62d74bb024990d71e"]
]) {
  it(`matches native raw bytes for ${format} input through null`, async () => {
    const result = await run(input, format);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stderr, "");
    assert.equal(result.output.toString("hex"), expected);
  });
}

it("deinterleaves each NV12 frame independently, including odd dimensions", async () => {
  const result = await run(Buffer.from("0001020304050607081020304050607080fffefdfcfbfaf9f8f78070605040302010", "hex"), "nv12", "3x3");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stderr, "");
  assert.equal(result.output.toString("hex"), "0001020304050607081030507020406080fffefdfcfbfaf9f8f78060402070503010");
});

it("renders NV12 chroma with the same subsampling as planar YUV420", async () => {
  const args = ["-vf", "null", "-pix_fmt", "rgba"];
  const actual = await run(input, "nv12", "2x4", args);
  const control = await run(Buffer.from("11589fe62d74bb0249d7901e", "hex"), "yuv420p", "2x4", args);
  assert.equal(actual.exitCode, 0, actual.stderr);
  assert.equal(control.exitCode, 0, control.stderr);
  assert.deepEqual(actual.output, control.output);
});

it("keeps original NV12 packets for stream copy, including a short final packet", async () => {
  const bytes = Buffer.concat([input, Buffer.from([1, 2, 3])]);
  const result = await run(bytes, "nv12", "2x4", ["-c:v", "copy"]);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stderr, "");
  assert.deepEqual(result.output, bytes);
});

it("preserves native planar frame timing and statistics after NV12 conversion", async () => {
  const result = await run(Buffer.concat([input, input]), "nv12", "2x4", ["-vf", "format=yuv420p,showinfo", "-pix_fmt", "yuv420p"]);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.output.toString("hex"), "11589fe62d74bb0249d7901e".repeat(2));
  assert.match(result.stderr, /n:0 pts:0 pts_time:0 duration:1 duration_time:0.25 fmt:yuv420p s:2x4 iskey:1/);
  assert.match(result.stderr, /n:1 pts:1 pts_time:0.25 duration:1 duration_time:0.25 fmt:yuv420p s:2x4 iskey:1/);
  assert.match(result.stderr, /checksum:20C7051A plane_checksum:\[0EB0034C 01690120 013E00AE\] mean:\[106 144 87\] stdev:\[77.2 71.0 57.0\]/);
});

for (const limits of [{ maxFrames: 0 }, { maxSamplesPerTrack: 0 }, { maxMemoryBytes: 1 }, { maxOutputBytes: 11 }]) {
  it(`enforces NV12 resource limits before emitting output: ${JSON.stringify(limits)}`, async () => {
    const result = await run(input, "nv12", "2x4", undefined, { limits });
    assert.notEqual(result.exitCode, 0);
    assert.match(result.stderr, /Resource limit exceeded/);
    assert.equal(result.output.length, 0);
  });
}
