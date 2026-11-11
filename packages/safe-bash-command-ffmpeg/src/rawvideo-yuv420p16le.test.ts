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
      "-framerate", "6", "-i", "/in.raw", ...outputArgs, "-f", "rawvideo", "/out.raw"],
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

// Complete binary output from FFmpeg 7.0.2, including partially filled tile padding.
for (const [format, samples, filter, output, expected] of [
  ["yuv420p16le", [4096, 8193, 32769, 60001, 20001, 48003], "null", "gray", "001383fe"],
  ["yuv420p16le", [4096, 8193, 32769, 60001, 20001, 48003], "tile=2x1", "gray", "0013000083fe0100"],
  ["yuv420p10le", [64, 128, 512, 938, 313, 750], "null", "yuv420p10le", "400080000002aa033901ee02"]
] as const) {
  it(`decodes ${format} through ${filter} to ${output}`, async () => {
    const bytes = Buffer.alloc(samples.length * 2);
    samples.forEach((value, index) => bytes.writeUInt16LE(value, index * 2));
    const result = await run(bytes, format,
      ["-vf", filter, "-fps_mode", "passthrough", "-pix_fmt", output], {}, "2x2");
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.output.toString("hex"), expected);
  });
}

it("decodes complete 16-bit frames and skips a final short packet", async () => {
  const frame = Buffer.from("00100120018061ea214e83bb", "hex");
  const result = await run(Buffer.concat([frame, frame, frame.subarray(0, 11)]), "yuv420p16le",
    ["-vf", "null", "-fps_mode", "passthrough", "-pix_fmt", "gray"], {}, "2x2");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.output.toString("hex"), "001383fe001383fe");
});

it("matches native 16-bit luma conversion across dither rows", async () => {
  const bytes = Buffer.alloc(16 * 16 * 3);
  for (let i = 0; i < bytes.length / 2; i++) bytes.writeUInt16LE((i * 8191 + 1) % 65536, i * 2);
  const result = await run(bytes, "yuv420p16le", ["-vf", "null", "-pix_fmt", "gray"], {}, "16x16");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.output.length, 256);
  assert.equal(createHash("sha256").update(result.output).digest("hex"),
    "5696c1c099143dbe6c9e5164cb77aea833964c5d2a7e5e400068cda27aa8aa5d");
});
