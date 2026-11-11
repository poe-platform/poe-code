import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const input = Buffer.from("61ea53c3459c37750d000d000d000d000d000d000d000d00", "hex");

async function run(bytes: Buffer, inputFormat: string, outputFormat: string, size = "2x2", maxOutputBytes?: number) {
  const volume = Volume.fromJSON({ "/in.raw": bytes, "/out.raw": "keep" });
  const stdout: Uint8Array[] = [];
  let stderr = "";
  const result = await createFfmpegCommand(maxOutputBytes === undefined ? {} : { limits: { maxOutputBytes } }).execute({
    args: ["-v", "error", "-y", "-f", "rawvideo", "-pixel_format", inputFormat, "-video_size", size,
      "-framerate", "1", "-i", "/in.raw", "-vf", "null", "-pix_fmt", outputFormat, "-f", "rawvideo",
      maxOutputBytes === undefined ? "pipe:1" : "/out.raw"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, data: Uint8Array) { volume.writeFileSync(path, data); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(),
    stdout: { async write(data: Uint8Array) { stdout.push(data); } },
    stderr: { async write(data: Uint8Array) { stderr += new TextDecoder().decode(data); } }
  } as never);
  return { ...result, stderr, output: Buffer.concat(stdout), volume };
}

for (const inputFormat of ["gray16le", "gray16be"]) {
  for (const [format, expected] of [
    ["gray10le", "a8030d037002d40100000000000000000000000000000000"],
    ["gray16le", input.toString("hex")]
  ] as const) {
    it(`writes native ${format} bytes from ${inputFormat} input`, async () => {
      const result = await run(inputFormat === "gray16le" ? input : Buffer.from(input).swap16(), inputFormat, format);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.stderr, "");
      assert.equal(result.output.toString("hex"), expected);
    });
  }

  // Native FFmpeg 7.0.2 output hashes: three identical frames, including black and white.
  // 9 rows exercise single-row slices; 129 rows exercise every dither row and wrapping.
  for (const [height, expected] of [
    [9, "4a3ffe133213301de1c0a111e3e87adbd2018d5f71eecb00c79aa7990af24986"],
    [129, "94d0c8d3ba40dce47aabd02809d763f96afb41bf5773839f8a9b9f63a26f6f93"]
  ] as const) {
    it(`matches native gray10le dithering across 9x${height} ${inputFormat} frames`, async () => {
      const frame = Buffer.alloc(9 * height * 2);
      for (let pixel = 0; pixel < 9 * height; pixel++) {
        frame.writeUInt16LE(pixel === 0 ? 0 : pixel === 9 * height - 1 ? 65535 : (pixel * 977 + 17) % 65536, pixel * 2);
      }
      if (inputFormat === "gray16be") frame.swap16();
      const result = await run(Buffer.concat([frame, frame, frame]), inputFormat, "gray10le", `9x${height}`);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.stderr, "");
      assert.equal(result.output.length, frame.length * 3);
      assert.equal(createHash("sha256").update(result.output).digest("hex"), expected);
    });
  }
}

it("enforces cumulative gray10le output limits without replacing an existing file", async () => {
  const result = await run(input, "gray16le", "gray10le", "2x2", input.length - 1);
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /maxOutputBytes/);
  assert.equal(result.volume.readFileSync("/out.raw", "utf8"), "keep");
  assert.equal(result.output.length, 0);
});
