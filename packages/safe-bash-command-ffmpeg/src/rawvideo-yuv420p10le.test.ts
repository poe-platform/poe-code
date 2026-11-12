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

// FFmpeg 7.0.2 exits successfully and produces these exact native YUV planes.
for (const [format, expected] of [
  ["yuv420p", "252526258125"],
  ["yuv422p", "2525262581822524"],
  ["yuv444p", "252526258182828125252425"]
]) {
  for (const filter of ["null", `format=${format}`]) {
    it(`reduces 10-bit YUV420 directly to ${format} with ${filter}`, async () => {
      const result = await run(Buffer.from("950095009500950006029300", "hex"), "yuv420p10le",
        ["-vf", filter, "-fps_mode", "passthrough", "-pix_fmt", format!, "-bitexact"], {}, "2x2");
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.output.toString("hex"), expected);
    });
  }
}

it("preserves both 10-bit frames through null filtering", async () => {
  const bytes = Buffer.from("2d002d002d002d0082009301950095009500950006029300", "hex");
  const result = await run(bytes, "yuv420p10le",
    ["-vf", "null", "-fps_mode", "passthrough", "-pix_fmt", "yuv420p10le", "-bitexact"], {}, "2x2");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.deepEqual(result.output, bytes);
});

// Native FFmpeg 7.0.2 references cover odd planes, every dither row, slice
// boundaries, multi-tap chroma filtering, and the scalar bottom-edge fallback.
for (const [width, height, hashes] of [
  [3, 3, ["99a0162bffffaeaf0850b74d242bd906ee43712a1e801b926d482343551cd831",
    "312a8fe9e5b59b8b658139b87d8a374b464f80224204843440e37c9832278b85",
    "6e2cb3ff2a343be231489d8e4396fc44a7642da760ff6dc02a0f3504d3d6514e"]],
  [16, 16, ["ad8a6b542b7206c7ac768abeb338f035e81e3714ce2c89ea76a5c79959e0eab2",
    "48d86c12b15f182ca48fa2b4c8d7b777a96be9689ca31aba5d587a3f7e3c597a",
    "0a6421d7dfff61a002a79b0e142b5adcfd04835013576e718d4fd7c91197e068"]],
  [16, 64, ["9e10e48f0a77db9a641206c21c14046ac705a2b422912e770740362eafe7ff8b",
    "cc2f393f80e0c4a528f3f73a130021d8c7dae130de284538ddde8678a9dbc6e9",
    "dbbb58ef3991c0b5300c142cb1aaffcd0beb9f0126536aee9ce16479022f4f72"]]
] as const) {
  for (const [index, format] of ["yuv420p", "yuv422p", "yuv444p"].entries()) {
    it(`matches native ${format} depth reduction for ${width}x${height}`, async () => {
      const bytes = Buffer.alloc((width * height + 2 * Math.ceil(width / 2) * Math.ceil(height / 2)) * 2);
      for (let i = 0; i < bytes.length / 2; i++) bytes.writeUInt16LE((i * 79 + 1) % 1024, i * 2);
      const result = await run(bytes, "yuv420p10le",
        ["-vf", `format=${format}`, "-fps_mode", "passthrough", "-pix_fmt", format, "-bitexact"], {}, `${width}x${height}`);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(createHash("sha256").update(result.output).digest("hex"), hashes[index]);
    });
  }
}

it("enforces 8-bit YUV output limits before replacing the destination", async () => {
  const result = await run(Buffer.from("950095009500950006029300", "hex"), "yuv420p10le",
    ["-vf", "null", "-pix_fmt", "yuv420p"], { limits: { maxOutputBytes: 5 } }, "2x2");
  assert.notEqual(result.exitCode, 0);
  assert.match(result.stderr, /maxOutputBytes/);
  assert.equal(result.output.toString(), "KEEP");
});

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
