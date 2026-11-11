import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const input = Buffer.from("2f3a45505b66717c87929da8b3bec9d4", "hex");

async function run(bytes: Buffer, inputFormat: string, outputFormat: string, size = "4x2", maxOutputBytes?: number) {
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

// Exact bytes from native FFmpeg 7.0.2, with distinct Y, U and V samples.
for (const [format, expected] of [
  ["yuyv422", "2f873ab3459250be5b9d66c971a87cd4"],
  ["uyvy422", "872fb33a9245be509d5bc966a871d47c"],
  ["yuv422p", input.toString("hex")]
] as const) {
  for (const frames of [1, 2]) {
    it(`writes exact ${format} bytes for ${frames} frames`, async () => {
      const result = await run(Buffer.concat(Array.from({ length: frames }, () => input)), "yuv422p", format);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.stderr, "");
      assert.equal(result.output.toString("hex"), expected.repeat(frames));
    });
  }
  it(`enforces cumulative ${format} output limits before writing`, async () => {
    const result = await run(Buffer.concat([input, input]), "yuv422p", format, "4x2", 31);
    assert.equal(result.exitCode, 1);
    assert.match(result.stderr, /maxOutputBytes/);
    assert.equal(result.volume.readFileSync("/out.raw", "utf8"), "keep");
    assert.equal(result.output.length, 0);
  });
}

for (const [format, expected] of [
  ["yuyv422", "2f873ab3459250be509d5bc966a887d4"],
  ["uyvy422", "872fb33a9245be509d50c95ba866d487"]
] as const) {
  it(`matches native ${format} row packing for odd widths`, async () => {
    const result = await run(Buffer.from("2f3a45505b6687929da8b3bec9d4", "hex"), "yuv422p", format, "3x2");
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stderr, "");
    assert.equal(result.output.toString("hex"), expected);
  });
}
