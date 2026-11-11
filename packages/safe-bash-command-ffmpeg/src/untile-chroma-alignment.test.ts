import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createCommandArguments } from "safe-bash-contracts";
import { createFfmpegCommand } from "./index.js";

async function run(format: string, width: number, height: number, length: number, filter: string, complex = false, file = false) {
  const input = Buffer.from(Array.from({ length }, (_, i) => (i * 53 + 39) % 256));
  const volume = Volume.fromJSON({ "/in.raw": input, "/out.raw": "KEEP" });
  const before = volume.toJSON();
  const argumentValues = createCommandArguments([
    "-hide_banner", "-nostats", "-v", "info", "-y", "-f", "rawvideo", "-pixel_format", format,
    "-video_size", `${width}x${height}`, "-framerate", "4", "-i", "/in.raw",
    ...(complex ? ["-filter_complex", `[0:v]${filter},showinfo[out]`, "-map", "[out]"]
      : ["-vf", `${filter},showinfo`]),
    "-fps_mode", "passthrough", "-pix_fmt", format, "-f", "rawvideo", file ? "/out.raw" : "pipe:1"
  ]);
  const output: Uint8Array[] = [];
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    command: "ffmpeg", args: argumentValues.args, argumentValues,
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(),
    stdout: { async write(bytes: Uint8Array) { output.push(bytes); } },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  assert.deepEqual(volume.toJSON(), before);
  return { ...result, bytes: Buffer.concat(output), stderr };
}

for (const [format, width, height, length, layout] of [
  ["yuv420p", 6, 2, 18, "2x1"],
  ["yuv420p", 2, 6, 18, "1x2"],
  ["yuv422p", 6, 2, 24, "2x1"],
  ["yuv420p10le", 6, 2, 36, "2x1"],
  ["yuv420p10le", 2, 6, 36, "1x2"]
] as const) {
  for (const complex of [false, true]) {
    it(`rejects ${format} ${width}x${height} cells outside the chroma grid (complex=${complex})`, async () => {
      const result = await run(format, width, height, length, `untile=${layout}`, complex);
      assert.equal(result.exitCode, 234, result.stderr);
      assert.equal(result.bytes.length, 0);
      assert.ok(result.stderr.includes("untile: input dimensions must be multiples of the layout"), result.stderr);
      assert.ok(!result.stderr.includes(" pts_time:"), result.stderr);
    });
  }
}

it("preserves an existing output file when untile rejects chroma alignment", async () => {
  const result = await run("yuv420p", 6, 2, 18, "untile=2x1", false, true);
  assert.equal(result.exitCode, 234, result.stderr);
});

// Native FFmpeg 7.0.2 aligned control from the same deterministic raw input.
it("preserves aligned YUV420 cells and their timestamps", async () => {
  const result = await run("yuv420p", 4, 2, 12, "untile=2x1");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.bytes.toString("hex"), "275cfb30cf3991c6659a046e");
  assert.ok(result.stderr.includes("n:0 pts:0 pts_time:0 "), result.stderr);
  assert.ok(result.stderr.includes("n:1 pts:1 pts_time:0.125 "), result.stderr);
});

for (const [format, width, height, length, filter] of [
  ["yuv422p", 2, 6, 24, "untile=1x2"],
  ["yuv444p", 6, 2, 36, "untile=2x1"],
  ["gray", 6, 2, 12, "untile=2x1"],
  ["yuv420p", 6, 2, 18, "format=rgba,negate,untile=2x1"]
] as const) {
  it(`accepts ${format} ${width}x${height} with ${filter}`, async () => {
    const result = await run(format, width, height, length, filter);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.ok(result.bytes.length > 0);
  });
}
