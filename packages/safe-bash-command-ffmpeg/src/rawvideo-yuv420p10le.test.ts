import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

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

// FFmpeg 7.0.2 reference bytes from the reported decoder and encoder cases.
for (const [format, input, output, expected] of [
  ["yuv420p10le", "39008c00df0032018501d801", "yuv420p10le", "39008c00df0032018501d801"],
  ["yuv420p10le", "400080000002aa033901ee02", "yuv420p10le", "400080000002aa033901ee02"],
  ["gray", "0a0b1e1f", "yuv420p10le", "62006600a700ab0000020002"],
  ["gray", "0a0b1e1f", "yuv420p", "19192a2b8080"],
  ["yuv420p10le", "39008c00df0032018501d801", "rgb24", "0011000429001c4200355a08"],
  ["yuv420p", "101a242e3842", "yuv420p10le", "400068009000b800e0000801"]
]) {
  it(`converts rawvideo ${format} to ${output}`, async () => {
    const result = await run(Buffer.from(input!, "hex"), format!,
      ["-vf", "null", "-fps_mode", "passthrough", "-pix_fmt", output!, "-bitexact"], {}, "2x2");
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.output.toString("hex"), expected);
  });
}

for (const filter of ["null", "format=gray"]) {
  it(`converts 10-bit luma to native gray samples with ${filter}`, async () => {
    const result = await run(Buffer.from("400080000002aa033901ee02", "hex"), "yuv420p10le",
      ["-vf", filter, "-fps_mode", "passthrough", "-pix_fmt", "gray"], {}, "2x2");
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.output.toString("hex"), "001383fe");
  });
}

it("matches native gray dithering across rows and clips out-of-range luma", async () => {
  const bytes = Buffer.alloc(16 * 16 * 3);
  // Native FFmpeg reference covering all eight dither rows and both clipping limits.
  for (let i = 0; i < bytes.length / 2; i++) bytes.writeUInt16LE((i * 79 + 1) % 1024, i * 2);
  const result = await run(bytes, "yuv420p10le", ["-vf", "format=gray", "-pix_fmt", "gray"], {}, "16x16");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.output.length, 256);
  assert.equal(createHash("sha256").update(result.output).digest("hex"),
    "9fb99ab0529a83204319e064e78761a334edaa7d7ef02af7ff2242054d14c6c4");
});

for (const copy of [false, true]) {
  it(`preserves 10-bit odd-sized frames and handles short packets (copy=${copy})`, async () => {
    // Two 3x3 frames: nine luma and four samples per chroma plane, two bytes each.
    const bytes = Buffer.alloc(70);
    for (let i = 0; i < 35; i++) bytes.writeUInt16LE((i * 83 + 1) % 1024, i * 2);
    const result = await run(bytes, "yuv420p10le", ["-c:v", copy ? "copy" : "rawvideo"],
      copy ? { limits: { maxFrames: 0 }, features: { videoTranscode: false } } : {}, "3x3");
    assert.equal(result.exitCode, 0, result.stderr);
    assert.deepEqual(result.output, copy ? bytes : bytes.subarray(0, 68));
  });
}

it("enforces 10-bit output byte limits before replacing the destination", async () => {
  const result = await run(Buffer.from("0a0b1e1f", "hex"), "gray", ["-pix_fmt", "yuv420p10le"],
    { limits: { maxOutputBytes: 11 } }, "2x2");
  assert.notEqual(result.exitCode, 0);
  assert.match(result.stderr, /maxOutputBytes/);
  assert.equal(result.output.toString(), "KEEP");
});
